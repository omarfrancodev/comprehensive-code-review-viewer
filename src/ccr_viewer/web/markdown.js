/**
 * Canalización segura de Markdown.
 *
 * El informe de origen es dato, nunca instrucción. El orden es deliberado:
 * 1) marked distingue los tokens HTML del código literal,
 * 2) el renderizador escapa HTML e imágenes mientras genera el HTML Markdown,
 * 3) DOMPurify lo depura con una lista de etiquetas estrictamente Markdown,
 * 4) los enlaces e imágenes se clasifican y se vuelven seguros.
 */

// Se usan las copias vendorizadas locales: nunca node_modules ni una CDN.
import { marked, Renderer } from "./vendor/marked.esm.js";
import DOMPurify from "./vendor/purify.es.mjs";

/** Etiquetas que sobreviven: Markdown estándar, sin HTML incrustado. */
const ETIQUETAS_PERMITIDAS = [
  "p", "br", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "em", "del", "s", "sub", "sup",
  "ul", "ol", "li",
  "blockquote", "pre", "code",
  "table", "thead", "tbody", "tr", "th", "td",
  "a",
];

const ATRIBUTOS_PERMITIDOS = ["href", "title", "colspan", "rowspan", "align"];

const ESQUEMAS_BLOQUEADOS = ["javascript:", "data:", "file:", "vbscript:", "blob:"];

/**
 * Rangos que un navegador elimina de una URL antes de interpretarla, más los
 * espacios no separables que sirven para ocultar un esquema. Se comparan por
 * código para no depender de literales invisibles en el código fuente.
 */
const RANGOS_OCULTOS = [
  [0x0000, 0x0020],
  [0x007f, 0x00a0],
  [0x1680, 0x1680],
  [0x2000, 0x200f],
  [0x2028, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
  [0xfeff, 0xfeff],
];

const ENTIDAD_NUMERICA = /&#(x[0-9a-fA-F]+|[0-9]+);?/gi;

function esOculto(codigo) {
  return RANGOS_OCULTOS.some(([inicio, fin]) => codigo >= inicio && codigo <= fin);
}

/** Elimina controles y entidades que se usan para partir un esquema peligroso. */
function normalizar(esquema) {
  const desofuscado = String(esquema ?? "").replace(ENTIDAD_NUMERICA, (coincidencia, numero) => {
    const esHexadecimal = numero.toLowerCase().startsWith("x");
    const valor = esHexadecimal
      ? Number.parseInt(numero.slice(1), 16)
      : Number.parseInt(numero, 10);
    return Number.isFinite(valor) && valor >= 0 && valor <= 0x10ffff
      ? String.fromCodePoint(valor)
      : coincidencia;
  });
  const sinControles = [...desofuscado]
    .filter((caracter) => !esOculto(caracter.codePointAt(0)))
    .join("");
  // El porcentaje tambien oculta un esquema: %6Aavascript: es javascript:.
  try {
    return decodeURIComponent(sinControles);
  } catch {
    return sinControles;
  }
}

/** Clasifica un destino de enlace o imagen. */
export function classifyLink(raw) {
  const limpio = normalizar(raw);
  if (limpio === "") return "blocked";
  const minusculas = limpio.toLowerCase();

  for (const esquema of ESQUEMAS_BLOQUEADOS) {
    if (minusculas.startsWith(esquema)) return "blocked";
  }
  if (minusculas.startsWith("http://") || minusculas.startsWith("https://")) {
    return "external";
  }
  // Una ruta absoluta del sistema o una salida del directorio es fuera de la raíz.
  if (limpio.startsWith("/") || limpio.startsWith("\\")) return "blocked";
  if (/^[a-zA-Z]:[\\/]/.test(limpio)) return "blocked";
  const partes = limpio.replace(/\\/g, "/").split("/");
  if (partes.includes("..")) return "blocked";
  return "local";
}

/**
 * Convierte el HTML crudo del origen en texto inerte antes de que marked lo vea.
 * El Markdown legítimo (encabezados, énfasis, tablas, código) no se toca.
 */
export function escapeRawHtml(texto) {
  // Solo se escapa "<": basta para que ninguna etiqueta exista, y escapar ">"
  // romperia las citas Markdown, que empiezan con ese caracter.
  return String(texto ?? "").replace(/<(?=[/!a-zA-Z])/g, "&lt;");
}

/** Deja el texto intacto pero muestra su alternativa cuando no se puede cargar. */
function textoAlternativo(alt, titulo) {
  const piezas = [];
  if (alt) piezas.push(String(alt));
  if (titulo && titulo !== alt) piezas.push(String(titulo));
  if (piezas.length === 0) piezas.push("imagen omitida por seguridad");
  return piezas.join(" — ");
}

/**
 * Renderiza Markdown en `contenedor`, dejando el original intacto.
 * `resolveLink` recibe los destinos locales y devuelve su clave opaca.
 */
export function renderMarkdown(texto, contenedor, resolveLink) {
  const resolver = typeof resolveLink === "function" ? resolveLink : () => null;
  const escape = text => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const renderer = new Renderer();
  renderer.html = token => escape(token.text);
  renderer.image = token => escape(`[${textoAlternativo(token.text, token.title)}]`);
  // Sólo los tokens HTML son texto inerte. Marked conserva el código literal.
  const generado = marked.parse(String(texto ?? ""), {
    gfm: true, breaks: true, async: false,
    renderer,
  });

  const limpio = DOMPurify.sanitize(generado, {
    ALLOWED_TAGS: ETIQUETAS_PERMITIDAS,
    ALLOWED_ATTR: ATRIBUTOS_PERMITIDOS,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    FORBID_TAGS: ["style", "script", "iframe", "form", "svg", "math", "object", "embed"],
    FORBID_ATTR: ["style", "srcset"],
  });

  const plantilla = document.createElement("template");
  plantilla.innerHTML = limpio;
  const raiz = plantilla.content;

  for (const imagen of raiz.querySelectorAll("img")) {
    const alternativo = textoAlternativo(imagen.getAttribute("alt"), imagen.getAttribute("title"));
    const reemplazo = document.createElement("span");
    reemplazo.className = "imagen-omitida";
    reemplazo.textContent = `[${alternativo}]`;
    imagen.replaceWith(reemplazo);
  }

  for (const enlace of raiz.querySelectorAll("a")) {
    const destino = enlace.getAttribute("href") ?? "";
    const clase = classifyLink(destino);
    if (clase === "blocked") {
      const texto = document.createElement("span");
      texto.className = "enlace-bloqueado";
      texto.textContent = `${enlace.textContent} (destino no permitido: ${destino})`;
      enlace.replaceWith(texto);
      continue;
    }
    if (clase === "external") {
      // Nunca se solicita nada por sí solo: hace falta un clic explícito.
      enlace.setAttribute("target", "_blank");
      enlace.setAttribute("rel", "noopener noreferrer");
      enlace.setAttribute("referrerpolicy", "no-referrer");
      enlace.classList.add("enlace-remoto");
      continue;
    }
    const resuelto = resolver(destino);
    if (resuelto && resuelto.fileKey) {
      enlace.setAttribute("href", "#documento");
      enlace.setAttribute("data-file-key", resuelto.fileKey);
      enlace.setAttribute("data-run-key", resuelto.runKey ?? "");
      enlace.classList.add("enlace-local");
      enlace.addEventListener("click", event => {
        event.preventDefault();
        contenedor.dispatchEvent(new CustomEvent("open-local-document", { bubbles: true, detail: { ...resuelto, fragment: destino.split("#")[1] ?? null } }));
      });
    } else {
      const texto = document.createElement("span");
      texto.className = "enlace-no-resuelto";
      texto.textContent = `${enlace.textContent} (sin resolver)`;
      texto.title = resuelto?.reason ?? "La referencia no se pudo resolver dentro de la raíz.";
      enlace.replaceWith(texto);
    }
  }

  contenedor.replaceChildren();
  contenedor.classList.add("markdown");
  contenedor.append(raiz);
  return contenedor;
}
