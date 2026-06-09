import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';

// There's no standalone landing page — send visitors straight into the game.
// 307 (temporary) so it isn't permanently cached if a real home page lands later.
export const load = () => redirect(307, resolve('/play'));
