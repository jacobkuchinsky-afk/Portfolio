// The two cards that appear either side of the wing in scene 2.
// Left card first (behind the wing, over the tail), then right (over the nose).
//
// image: a path under public/, e.g. '/portfolio/project-one.webp'
//        (keep it small: ~720 px wide WebP). null shows a placeholder.
// link:  href opens in a new tab.
//
// PLACEHOLDER CONTENT: replace with the real projects.
export const SHOWCASE = [
  {
    title: 'Project one',
    text: 'A couple of sentences about what this is, what you built, and what you are proud of. Replace this in src/content/portfolio.js.',
    image: null,
    imageAlt: '',
    link: { label: 'View project', href: '#' },
  },
  {
    title: 'Project two',
    text: 'A couple of sentences about what this is, what you built, and what you are proud of. Replace this in src/content/portfolio.js.',
    image: null,
    imageAlt: '',
    link: { label: 'View project', href: '#' },
  },
]

// Scene 3: the game card that fades in while the plane floats in space.
// Price and description are fetched live from Steam (see api/_steam.js);
// these are the fallbacks if that fails.
export const CONSTELLAR = {
  title: 'Constellar',
  kicker: 'My game · out now on Steam',
  image: '/images/constellar.webp',
  imageAlt: 'Constellar title art: a pixel-art space shuttle over a blue planet, surrounded by enemy ships',
  storeUrl: 'https://store.steampowered.com/app/4148950/Constellar/',
  description:
    'A reinterpretation of retro games like Space Invaders and Galaga with a modern twist. Battle through planetary sectors using elemental abilities that combine for powerful effects and make bosses vanish.',
  price: { final: '$3.99', initial: null, discount: 0 },
}
