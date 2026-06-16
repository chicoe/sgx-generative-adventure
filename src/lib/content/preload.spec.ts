import { describe, it, expect } from 'vitest';
import { collectBuildAssets } from './preload';
import type { Build, Scene } from '../engine/types';

const scene = (over: Partial<Scene>): Scene => ({
	id: 'a',
	name: 'A',
	layers: [],
	hotspots: [],
	exits: [],
	...over
});

const build = (over: Partial<Build>): Build => ({
	meta: { version: 1, publishedAt: 'now', startSceneId: 'a' },
	scenes: [],
	items: [],
	behaviours: [],
	...over
});

describe('collectBuildAssets', () => {
	it('gathers layer images (all variants), item icons and ambient audio', () => {
		const b = build({
			scenes: [
				scene({
					id: 's1',
					layers: [
						{
							id: 'bg',
							imagePath: 'a.png',
							imagePaths: ['a.png', 'b.png'],
							z: 0,
							parallaxFactor: 0
						}
					],
					ambientSound: 'https://store/loop.mp3'
				})
			],
			items: [{ id: 'k', name: 'Key', iconPath: 'icons/key.png', description: '' }]
		});
		const assets = collectBuildAssets(b);
		expect(assets).toContain('/a.png');
		expect(assets).toContain('/b.png');
		expect(assets).toContain('https://store/loop.mp3');
		expect(assets).toContain('/icons/key.png');
	});

	it('dedupes shared assets and passes absolute URLs through', () => {
		const b = build({
			scenes: [
				scene({
					id: 's1',
					layers: [{ id: 'l', imagePath: 'https://x/img.png', z: 0, parallaxFactor: 0 }]
				}),
				scene({
					id: 's2',
					layers: [{ id: 'l', imagePath: 'https://x/img.png', z: 0, parallaxFactor: 0 }]
				})
			]
		});
		expect(collectBuildAssets(b)).toEqual(['https://x/img.png']);
	});

	it('skips empty paths', () => {
		const b = build({
			scenes: [scene({ layers: [{ id: 'l', imagePath: '', z: 0, parallaxFactor: 0 }] })],
			items: [{ id: 'k', name: 'K', iconPath: '', description: '' }]
		});
		expect(collectBuildAssets(b)).toEqual([]);
	});
});
