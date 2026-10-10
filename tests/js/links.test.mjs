import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyLink, escapeRawHtml } from "../../src/ccr_viewer/web/markdown.js";

describe("classifyLink", () => {
  it("reconoce enlaces locales, remotos y esquemas peligrosos", () => {
    assert.equal(classifyLink("informe.md"), "local");
    assert.equal(classifyLink("evidence/notas.json"), "local");
    assert.equal(classifyLink("https://ejemplo.invalid/x"), "external");
    assert.equal(classifyLink("http://ejemplo.invalid/x"), "external");
    assert.equal(classifyLink("javascript:alert(1)"), "blocked");
    assert.equal(classifyLink("JaVaScRiPt:alert(1)"), "blocked");
    assert.equal(classifyLink("data:text/html;base64,PHNjcmlwdD4="), "blocked");
    assert.equal(classifyLink("file:///etc/passwd"), "blocked");
    assert.equal(classifyLink("vbscript:msgbox(1)"), "blocked");
  });

  it("normaliza los espacios y el codificado antes de decidir", () => {
    assert.equal(classifyLink("java\tscript:alert(1)"), "blocked");
    assert.equal(classifyLink("java\nscript:alert(1)"), "blocked");
    assert.equal(classifyLink("  javascript:alert(1)"), "blocked");
    assert.equal(classifyLink("&#106;avascript:alert(1)"), "blocked");
    assert.equal(classifyLink("%6Aavascript:alert(1)"), "blocked");
  });

  it("un enlace local nunca es una ruta absoluta del sistema", () => {
    assert.equal(classifyLink("/etc/passwd"), "blocked");
    assert.equal(classifyLink("C:/Windows/System32"), "blocked");
    assert.equal(classifyLink("..\\..\\fuera"), "blocked");
  });
});

describe("escapeRawHtml", () => {
  it("convierte las etiquetas HTML crudas en texto inerte", () => {
    const escapado = escapeRawHtml("<script>alert(1)</script>");
    // Basta con neutralizar "<": ninguna etiqueta sobrevive. Escapar ">"
    // rompería las citas Markdown, que empiezan con ese carácter.
    assert.ok(!escapado.includes("<"), "ninguna etiqueta debe sobrevivir");
    assert.ok(escapado.includes("&lt;script"));
  });

  it("neutraliza atributos con manejadores de evento", () => {
    const escapado = escapeRawHtml('<img src=x onerror="alert(1)">');
    assert.ok(!escapado.includes("<img"));
    assert.ok(escapado.includes("&lt;img"));
  });

  it("no altera el contenido Markdown legítimo", () => {
    const original = "## Título\n\nTexto con `código` y **negrita**.";
    assert.equal(escapeRawHtml(original), original);
  });

  it("escapa también las unidades SVG y MathML", () => {
    for (const etiqueta of ["<svg/onload=alert(1)>", "<math><mi>x</mi></math>", "<iframe src=x>"]) {
      const escapado = escapeRawHtml(etiqueta);
      assert.ok(!escapado.includes("<"), `debe escapar: ${etiqueta}`);
    }
  });
});