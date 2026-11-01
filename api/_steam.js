// Constellar's price and description from the Steam store, for the scene 3
// card. Steam's store API doesn't allow requests from other websites (no
// CORS headers), so the page asks /api/steam on our own site and this fetches
// it server side. One shared handler; the files next to it hook it up for
// whichever host the site is deployed on (Vercel, Netlify or Cloudflare
// Pages), and vite.config.js serves it in dev. On a host with no functions
// the request fails and the card shows its built-in fallback price.
//
// (The underscore keeps Vercel from treating this file as a route.)

export const APP_ID = 4148950

const json = (body, status, cache) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache },
  })

// country: the visitor's two-letter country code from the host's geo header,
// so they see their own currency. Unknown → US prices.
export async function steamResponse(country) {
  const cc = /^[a-z]{2}$/i.test(country ?? '') ? country.toLowerCase() : 'us'
  try {
    const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${APP_ID}&cc=${cc}&l=english`, {
      signal: AbortSignal.timeout(4000),
    })
    const app = (await res.json())?.[APP_ID]
    if (!app?.success) throw new Error('Steam has no data for the app')
    const { is_free, price_overview: p, short_description } = app.data
    const price = is_free
      ? { final: 'Free', initial: null, discount: 0 }
      : p && { final: p.final_formatted, initial: p.discount_percent ? p.initial_formatted : null, discount: p.discount_percent }
    // Cached in the visitor's browser only: a shared CDN cache would hand one
    // country's currency to everyone
    return json({ price, description: short_description }, 200, 'private, max-age=600')
  } catch (error) {
    return json({ error: String(error?.message ?? error) }, 502, 'no-store')
  }
}
