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
