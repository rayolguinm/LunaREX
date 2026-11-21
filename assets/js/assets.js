// Asset path resolver. On the hosted site every path is a normal relative URL; the single-file build
// fills window.__ASSETS with the same paths mapped to embedded data, so nothing else changes.
// Author: Raymundo "R@y" Olguin, LunaREX.
export const A = (p) => (typeof window !== "undefined" && window.__ASSETS && window.__ASSETS[p]) || p;
