import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PREFS_KEY,
  applyPrefs,
  loadPrefs,
  prefersReducedMotion,
  savePrefs,
} from "../../src/ccr_viewer/web/prefs.js";

const POR_OMISION = { theme: "system", density: "comfortable", motion: "system" };

function almacenamiento(inicial = {}) {
  const datos = new Map(Object.entries(inicial));
  return {
    datos,
    getItem: (clave) => (datos.has(clave) ? datos.get(clave) : null),
    setItem: (clave, valor) => datos.set(clave, String(valor)),
  };
}

describe("loadPrefs", () => {
  it("usa los valores por omisión si el almacenamiento lanza", () => {
    const roto = { getItem() { throw new Error("bloqueado"); } };
    assert.deepEqual(loadPrefs(roto), POR_OMISION);
  });

  it("usa los valores por omisión sin almacenamiento disponible", () => {
    assert.deepEqual(loadPrefs(null), POR_OMISION);
  });

  it("descarta valores fuera del vocabulario", () => {
    const store = almacenamiento({ [PREFS_KEY]: JSON.stringify({ theme: "neon" }) });
    assert.equal(loadPrefs(store).theme, "system");
  });

  it("ignora JSON inválido y valores que no son objetos", () => {
    assert.deepEqual(loadPrefs(almacenamiento({ [PREFS_KEY]: "{no" })), POR_OMISION);
    assert.deepEqual(loadPrefs(almacenamiento({ [PREFS_KEY]: "[1]" })), POR_OMISION);
    assert.deepEqual(loadPrefs(almacenamiento({ [PREFS_KEY]: "null" })), POR_OMISION);
  });

  it("conserva los valores válidos", () => {
    const guardado = { theme: "dark", density: "compact", motion: "reduce" };
    const store = almacenamiento({ [PREFS_KEY]: JSON.stringify(guardado) });
    assert.deepEqual(loadPrefs(store), guardado);
  });
});

describe("savePrefs", () => {
  it("no lanza si setItem lanza", () => {
    const roto = { setItem() { throw new Error("cuota"); } };
    assert.doesNotThrow(() => savePrefs({ theme: "dark" }, roto));
  });

  it("no lanza sin almacenamiento", () => {
    assert.doesNotThrow(() => savePrefs({ theme: "dark" }, null));
  });

  it("guarda solo las claves conocidas bajo la clave de preferencias", () => {
    const store = almacenamiento();
    savePrefs({ theme: "light", density: "compact", motion: "reduce", token: "secreto", extra: 1 }, store);
    assert.deepEqual([...store.datos.keys()], ["ccr-viewer:prefs"]);
    const guardado = JSON.parse(store.datos.get("ccr-viewer:prefs"));
    assert.deepEqual(Object.keys(guardado).sort(), ["density", "motion", "theme"]);
    assert.deepEqual(guardado, { theme: "light", density: "compact", motion: "reduce" });
  });

  it("no persiste valores fuera del vocabulario", () => {
    const store = almacenamiento();
    savePrefs({ theme: "neon", density: "enorme", motion: "mucho" }, store);
    assert.deepEqual(JSON.parse(store.datos.get(PREFS_KEY)), POR_OMISION);
  });
});

describe("prefersReducedMotion", () => {
  it("la preferencia explícita «reduce» gana", () => {
    assert.equal(prefersReducedMotion({ motion: "reduce" }, () => ({ matches: false })), true);
  });

  it("«system» sigue la preferencia del sistema", () => {
    assert.equal(prefersReducedMotion({ motion: "system" }, () => ({ matches: true })), true);
    assert.equal(prefersReducedMotion({ motion: "system" }, () => ({ matches: false })), false);
  });

  it("sin matchMedia no reduce", () => {
    assert.equal(prefersReducedMotion({ motion: "system" }, null), false);
    assert.equal(prefersReducedMotion({ motion: "system" }, () => { throw new Error("no"); }), false);
  });
});

describe("applyPrefs", () => {
  it("fija el tema explícito y lo borra con «system»", () => {
    const root = { dataset: {} };
    applyPrefs(root, { theme: "dark", density: "comfortable", motion: "system" });
    assert.equal(root.dataset.theme, "dark");
    applyPrefs(root, { theme: "system", density: "comfortable", motion: "system" });
    assert.equal("theme" in root.dataset, false);
  });

  it("refleja densidad compacta y movimiento reducido", () => {
    const root = { dataset: {} };
    applyPrefs(root, { theme: "light", density: "compact", motion: "reduce" });
    assert.equal(root.dataset.density, "compact");
    assert.equal(root.dataset.motion, "reduce");
    applyPrefs(root, POR_OMISION);
    assert.deepEqual({ ...root.dataset }, {});
  });
});
