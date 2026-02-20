/**
 * theme-presets.js - cover/back theme presets (v1)
 */

export const THEME_TEMPLATES = {
    classic: { id: 'classic', label: 'Classic' },
    minimal: { id: 'minimal', label: 'Minimal' },
    bold: { id: 'bold', label: 'Bold' },
    novel: { id: 'novel', label: 'Novel' }
};

export const THEME_PALETTES = {
    ocean: { bg: '#dceeff', fg: '#12395f', accent: '#2a74b8', sub: '#3e5d7d' },
    sunset: { bg: '#ffe6d6', fg: '#6f2f1f', accent: '#c95a35', sub: '#8a4d3f' },
    forest: { bg: '#e1f2e4', fg: '#224e2b', accent: '#2f8153', sub: '#3e6747' },
    amber: { bg: '#fff1d9', fg: '#6a4a14', accent: '#ca8a18', sub: '#8e6f3e' },
    mono: { bg: '#f2f4f7', fg: '#252b35', accent: '#5e6b7a', sub: '#6f7b89' },
    sakura: { bg: '#ffe8ef', fg: '#6b3044', accent: '#b74f73', sub: '#855266' },
    navy: { bg: '#e6ecff', fg: '#1f2f5a', accent: '#3f5fb2', sub: '#4d5f8f' },
    mint: { bg: '#e2faf1', fg: '#1f5646', accent: '#27a37f', sub: '#447a68' },
    stone: { bg: '#eceae7', fg: '#3f3a33', accent: '#807467', sub: '#6a6258' },
    crimson: { bg: '#ffe3e8', fg: '#5f1e2a', accent: '#ba3d57', sub: '#854752' }
};

export function getThemePalette(id) {
    return THEME_PALETTES[id] || THEME_PALETTES.ocean;
}

export function getThemeTemplate(id) {
    return THEME_TEMPLATES[id] || THEME_TEMPLATES.classic;
}

