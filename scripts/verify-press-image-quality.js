import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assessPressImageSourceResolution } from '../js/press-image-quality.js';

assert.deepEqual(
    assessPressImageSourceResolution({ sourceWidth: 1080, sourceHeight: 1920, frameWidth: 1080, frameHeight: 1920 }),
    { status: 'sufficient', upscaleRatio: 1 },
);
assert.equal(
    assessPressImageSourceResolution({ sourceWidth: 360, sourceHeight: 640, frameWidth: 1080, frameHeight: 1920 }).status,
    'upscaled',
);
assert.equal(
    assessPressImageSourceResolution({ sourceWidth: 1920, sourceHeight: 1080, frameWidth: 1080, frameHeight: 1920 }).upscaleRatio,
    1.778,
    'A landscape source cropped into a portrait page must report the vertical enlargement.',
);
assert.equal(
    assessPressImageSourceResolution({ sourceWidth: 2160, sourceHeight: 1920, frameWidth: 2160, frameHeight: 1920 }).status,
    'sufficient',
    'A native two-page spread must pass at FHD per page.',
);
assert.equal(
    assessPressImageSourceResolution({ sourceWidth: 1080, sourceHeight: 1920, frameWidth: 1080, frameHeight: 1920, scale: 1.5 }).upscaleRatio,
    1.5,
    'Author zoom must be included in the source-resolution diagnostic.',
);
assert.equal(assessPressImageSourceResolution({}).status, 'unknown');

const pressSource = fs.readFileSync(new URL('../js/press.js', import.meta.url), 'utf8');
const studioSource = fs.readFileSync(new URL('../studio.html', import.meta.url), 'utf8');
const i18nSource = fs.readFileSync(new URL('../js/i18n-studio.js', import.meta.url), 'utf8');
assert.match(studioSource, /id="press-image-quality-summary"/);
assert.match(pressSource, /void _requestPressImageQualityDiagnostics\(\)/);
assert.match(pressSource, /frameWidth: targetWidth \* \(groupId \? 2 : 1\)/);
assert.match(pressSource, /scale: position\.scale/);
assert.match(i18nSource, /press_image_quality_warning:\s+'\{count\} source images will be enlarged'/);

console.log('Press image source resolution diagnostics verification passed.');
