/**
 * Contraste WCAG de los tokens de color.
 *
 * Lee `tokens.css` tal como se publica y comprueba cada tema: el claro de
 * `:root`, el oscuro del sistema (`@media (prefers-color-scheme: dark)`) y los
 * dos temas forzados con `[data-theme]`. Texto ≥ 4.5:1; controles y foco ≥ 3:1.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const CSS = readFileSync(new URL("../../src/ccr_viewer/web/tokens.css", import.meta.url), "utf8");

/** Bloques `selector { cuerpo }` con la pila de reglas que los contiene. */
function bloques(css) {
  const texto = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const resultado = [];
  const pila = [];
  let inicio = 0;
  for (let i = 0; i < texto.length; i += 1) {
    const caracter = texto[i];
    if (caracter === "{") {
      pila.push({ selector: texto.slice(inicio, i).trim(), desde: i + 1 });
      inicio = i + 1;
    } else if (caracter === "}") {
      const abierto = pila.pop();
      resultado.push({
        selector: abierto.selector,
        contexto: pila.map((p) => p.selector),
        cuerpo: texto.slice(abierto.desde, i),
      });
      inicio = i + 1;
    } else if (caracter === ";" && pila.length === 0) {
      inicio = i + 1;
    }
  }
  return resultado;
}

function variables(cuerpo) {
  const valores = {};
  for (const [, nombre, valor] of cuerpo.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) valores[nombre] = valor.trim();
  return valores;
}

function rgb(hex) {
  const limpio = hex.replace("#", "");
  const completo = limpio.length === 3 ? [...limpio].map((c) => c + c).join("") : limpio;
  assert.match(completo, /^[0-9a-f]{6}$/i, `color hexadecimal esperado: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(completo.slice(i, i + 2), 16) / 255);
}

function luminancia(hex) {
  const [r, g, b] = rgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (oscuro + 0.05);
}

const TODOS = bloques(CSS);
const TEMAS = {
  "claro (:root)": TODOS.find((b) => b.selector === ":root" && b.contexto.length === 0),
  "oscuro del sistema": TODOS.find(
    (b) => b.selector === ':root:not([data-theme="light"])' && b.contexto.some((c) => /prefers-color-scheme:\s*dark/.test(c)),
  ),
  'forzado [data-theme="light"]': TODOS.find((b) => b.selector === ':root[data-theme="light"]' && b.contexto.length === 0),
  'forzado [data-theme="dark"]': TODOS.find((b) => b.selector === ':root[data-theme="dark"]' && b.contexto.length === 0),
};

const COLORES = ["--fondo", "--superficie", "--texto", "--texto-suave", "--borde", "--acento", "--foco", "--ok", "--aviso", "--error"];

/** [primer plano, mínimo] contra cada superficie de fondo. */
const TEXTO = 4.5;
const CONTROL = 3;
const PARES = [
  ["--texto", TEXTO],
  ["--texto-suave", TEXTO],
  ["--acento", TEXTO],
  ["--ok", TEXTO],
  ["--aviso", TEXTO],
  ["--error", TEXTO],
  ["--foco", CONTROL],
  ["--borde-control", CONTROL],
];

describe("tokens de color", () => {
  for (const [nombre, bloque] of Object.entries(TEMAS)) {
    describe(nombre, () => {
      it("existe y define todos los colores como hexadecimal", () => {
        assert.ok(bloque, `falta el bloque del tema ${nombre}`);
        const valores = variables(bloque.cuerpo);
        for (const color of [...COLORES, "--borde-control", "--acento-contraste"]) {
          assert.ok(valores[color], `${nombre} no define ${color}`);
          rgb(valores[color]);
        }
      });

      for (const fondo of ["--superficie", "--fondo"]) {
        for (const [color, minimo] of PARES) {
          it(`${color} sobre ${fondo} ≥ ${minimo}:1`, () => {
            const valores = variables(bloque.cuerpo);
            const obtenido = ratio(valores[color], valores[fondo]);
            assert.ok(obtenido >= minimo, `${color} ${valores[color]} / ${fondo} ${valores[fondo]} = ${obtenido.toFixed(2)}`);
          });
        }
      }

      it("el texto sobre el acento (selección) ≥ 4.5:1", () => {
        const valores = variables(bloque.cuerpo);
        const obtenido = ratio(valores["--acento-contraste"], valores["--acento"]);
        assert.ok(obtenido >= TEXTO, `--acento-contraste / --acento = ${obtenido.toFixed(2)}`);
      });
    });
  }

  it("los temas forzados coinciden con su equivalente del sistema", () => {
    const valores = Object.fromEntries(Object.entries(TEMAS).map(([nombre, bloque]) => [nombre, variables(bloque?.cuerpo ?? "")]));
    for (const color of COLORES) {
      assert.equal(valores['forzado [data-theme="light"]'][color], valores["claro (:root)"][color], color);
      assert.equal(valores['forzado [data-theme="dark"]'][color], valores["oscuro del sistema"][color], color);
    }
  });

  it("define escalas de espacio y radio y la densidad compacta", () => {
    const raiz = variables(TEMAS["claro (:root)"]?.cuerpo ?? "");
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6].map((n) => raiz[`--espacio-${n}`]),
      ["4px", "8px", "12px", "16px", "24px", "32px"],
    );
    assert.deepEqual([1, 2, 3].map((n) => raiz[`--radio-${n}`]), ["6px", "10px", "14px"]);
    assert.ok(TODOS.some((b) => b.selector === ':root[data-density="compact"]'), "falta la densidad compacta");
  });
});
