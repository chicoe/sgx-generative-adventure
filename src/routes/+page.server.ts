import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageServerLoad } from './$types';

// The landing page is the access-code gate (see +page.svelte). The only bypass
// is ?specialaccess=sgx, which goes straight into the game with no code.
export const load: PageServerLoad = ({ url }) => {
	if (url.searchParams.get('specialaccess') === 'sgx') {
		redirect(307, `${resolve('/play')}?specialaccess=sgx`);
	}
	return {};
};
