import fs from 'node:fs';
import assert from 'node:assert/strict';

const studio = fs.readFileSync(new URL('../studio.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const sections = fs.readFileSync(new URL('../js/sections.js', import.meta.url), 'utf8');

assert.match(studio, /onclick="insertFlowGroupBeforeActive\(\)"/, 'Flow must remain available as the primary text authoring action.');
assert.doesNotMatch(studio, /onclick="insertTextSectionBeforeActive\(\)"/, 'Legacy text pages must not be offered by the new-page UI.');
assert.doesNotMatch(app, /onclick="addSectionByType\('text', event\)"/, 'The tail add menu must not offer new legacy text pages.');

assert.match(app, /window\.insertTextSectionBeforeActive = \(\) => insertSectionBeforeActiveByType\('text'\)/, 'Legacy text creation compatibility must remain callable for old integrations.');
assert.match(sections, /function createTextSection\(\)/, 'Legacy text data support must remain available for existing projects.');
assert.match(sections, /export function addTextSection\(refresh\)/, 'Legacy text page handling must remain available for existing projects.');

console.log('Flow primary text authoring and legacy text compatibility verification passed.');
