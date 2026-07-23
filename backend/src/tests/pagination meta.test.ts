/**
 * Unit tests : buildPaginationMeta + options avancées de parsePagination
 * (src/lib/pagination.ts)
 *
 * parsePagination() de base (page/limit/offset par défaut) est déjà couvert
 * par business-rules.test.ts → describe('Pagination logic'). Ce fichier
 * complète avec buildPaginationMeta() et les options defaultLimit/maxLimit,
 * non testées ailleurs.
 *
 * Usage : bun test src/tests/pagination-meta.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { parsePagination, buildPaginationMeta } from '../lib/pagination';

// ─── parsePagination — options personnalisées ────────────────────────────────

describe('parsePagination — options defaultLimit / maxLimit', () => {
  test('defaultLimit personnalisé utilisé quand limit absent', () => {
    const result = parsePagination({}, { defaultLimit: 5 });
    expect(result.limit).toBe(5);
  });

  test('maxLimit personnalisé plafonne la limite demandée', () => {
    const result = parsePagination({ limit: '500' }, { maxLimit: 50 });
    expect(result.limit).toBe(50);
  });

  test('limit invalide (négative) → retombe sur defaultLimit fourni', () => {
    const result = parsePagination({ limit: '-10' }, { defaultLimit: 15 });
    expect(result.limit).toBe(15);
  });

  test('page=0 → retombe sur 1', () => {
    expect(parsePagination({ page: '0' }).page).toBe(1);
  });
});

// ─── buildPaginationMeta ──────────────────────────────────────────────────────

describe('buildPaginationMeta — métadonnées renvoyées au frontend', () => {
  test('total=0 → totalPages=0 (pas de division qui donne NaN ou Infinity)', () => {
    const meta = buildPaginationMeta(1, 20, 0);
    expect(meta).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0 });
  });

  test('total exactement divisible par limit', () => {
    const meta = buildPaginationMeta(1, 10, 30);
    expect(meta.totalPages).toBe(3);
  });

  test('total non divisible par limit → arrondi au supérieur', () => {
    const meta = buildPaginationMeta(1, 10, 25);
    expect(meta.totalPages).toBe(3); // 2.5 → 3
  });

  test('un seul élément → 1 page', () => {
    const meta = buildPaginationMeta(1, 20, 1);
    expect(meta.totalPages).toBe(1);
  });

  test('reflète fidèlement page/limit fournis, sans les recalculer', () => {
    const meta = buildPaginationMeta(4, 10, 100);
    expect(meta.page).toBe(4);
    expect(meta.limit).toBe(10);
    expect(meta.total).toBe(100);
    expect(meta.totalPages).toBe(10);
  });
});