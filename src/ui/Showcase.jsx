import { useEffect, useRef } from 'react'
import { useFlight } from '../state/useFlight.js'
import { SHOWCASE } from '../content/portfolio.js'

// Scene 2's two portfolio cards, either side of the banked plane's raised
// wing; the throttle in the dashboard takes it on from there. <ShowcaseAnchor>
// (inside the canvas) positions the cards and cuts their inner sides along
// the wing every frame, writing straight to these elements.
export const showcaseLayout = { el: null, cards: [] }

function Card({ item, index }) {
  const register = (root) => {
    if (!root) return void (showcaseLayout.cards[index] = null)
    showcaseLayout.cards[index] = {
      root,
      svg: root.querySelector('svg'),
      paths: root.querySelectorAll('path'),
      body: root.querySelector('.card-body'),
    }
  }
  return (
    <article ref={register} className={`card is-${index === 0 ? 'left' : 'right'}`}>
      {/* Outline and hard shadow follow the card's shape, which is cut along the wing */}
      <svg className="card-frame" preserveAspectRatio="none" aria-hidden="true">
        <path className="card-shadow" />
        <path className="card-fill" />
      </svg>
      <div className="card-body">
        <header className="card-head">
          <h2>{item.title}</h2>
          <span className="card-index">0{index + 1}</span>
        </header>
        {item.image ? (
          <img className="card-image" src={item.image} alt={item.imageAlt} loading="lazy" decoding="async" />
        ) : (
          <div className="card-image is-placeholder" aria-hidden="true">
            <span>Image</span>
          </div>
        )}
        <div className="card-text">
          <p>{item.text}</p>
        </div>
        <a className="card-link" href={item.link.href} target="_blank" rel="noopener noreferrer">
          {item.link.label}
        </a>
      </div>
    </article>
  )
}

export function Showcase() {
  const phase = useFlight((s) => s.phase)
  const ref = useRef(null)
  const shown = phase === 'slowmo' || phase === 'paused'

  useEffect(() => {
    showcaseLayout.el = ref.current
    return () => (showcaseLayout.el = null)
  }, [])

  return (
    <div ref={ref} className={`showcase${shown ? ' is-shown' : ''}`} aria-hidden={!shown}>
      {SHOWCASE.slice(0, 2).map((item, i) => (
        <Card key={i} item={item} index={i} />
      ))}
    </div>
  )
}
