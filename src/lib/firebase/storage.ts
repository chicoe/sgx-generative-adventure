// Image upload for the editor (browser SDK). Returns a public download URL,
// which we store directly in `imagePath` (SceneRenderer resolves absolute URLs
// as-is). Uploads require a signed-in user (storage.rules).
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from './client';

export async function uploadImage(file: File, prefix = 'scenes'): Promise<string> {
	const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
	const fileRef = ref(storage(), `${prefix}/${Date.now()}-${safe}`);
	await uploadBytes(fileRef, file);
	return getDownloadURL(fileRef);
}

// Scene ambient audio (looped on enter). Stored as-is — returns a download URL.
export async function uploadAudio(file: File): Promise<string> {
	return uploadImage(file, 'audio');
}

// Item icons are capped at 200×200 so the build never accumulates heavy images.
// PNG/JPEG larger than that are downscaled client-side (aspect preserved); GIFs
// can't be resized without losing their animation, so oversized ones are
// rejected with a clear message instead.
const ICON_MAX = 200;

export async function uploadItemIcon(file: File): Promise<string> {
	return uploadImage(await fitImage(file, ICON_MAX), 'items');
}

async function fitImage(file: File, max: number): Promise<File> {
	const bmp = await createImageBitmap(file);
	const { width, height } = bmp;
	if (width <= max && height <= max) {
		bmp.close();
		return file;
	}
	if (file.type === 'image/gif') {
		bmp.close();
		throw new Error(
			`GIFs can't be auto-resized without losing animation — please upload one at most ${max}×${max}px (this one is ${width}×${height}).`
		);
	}
	const scale = Math.min(max / width, max / height);
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.round(width * scale));
	canvas.height = Math.max(1, Math.round(height * scale));
	canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
	bmp.close();
	const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
	const blob = await new Promise<Blob>((resolve, reject) =>
		canvas.toBlob(
			(b) => (b ? resolve(b) : reject(new Error('Could not resize the image.'))),
			type,
			0.9
		)
	);
	const base = file.name.replace(/\.\w+$/, '');
	return new File([blob], `${base}${type === 'image/jpeg' ? '.jpg' : '.png'}`, { type });
}
