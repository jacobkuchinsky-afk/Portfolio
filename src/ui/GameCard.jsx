import { useEffect, useState } from 'react'
import { useFlight } from '../state/useFlight.js'
import { assetUrl } from '../boot/assets.js'
import { CONSTELLAR } from '../content/portfolio.js'

// Scene 3's last beat: the plane floats off to the left in zero g and the
// Constellar card fades in beside it, with the live Steam price (and the
// discount, when there's a sale) and a link to buy it. This is the card's
// face; <GameCard3D> stands it in the world next to the plane.

export const GAME_CARD_PHASES = new Set(['drift', 'enemy', 'fire', 'done'])

// Fetched once, as the boost starts, so it's ready by the time the card shows
let steam = null
function fetchSteam() {
  steam ??= fetch('/api/steam', { signal: AbortSignal.timeout(5000) })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`/api/steam: ${res.status}`))))
    .catch((error) => {
      console.warn('Steam price unavailable, using the fallback.', error)
      return {}
    })
  return steam
}

export function useSteam() {
  const phase = useFlight((s) => s.phase)
  const [live, setLive] = useState({})
  useEffect(() => {
    if (phase !== 'boost') return
    fetchSteam().then(setLive)
    new Image().src = assetUrl(CONSTELLAR.image) // warm the art up too
  }, [phase])
  return { price: live.price ?? CONSTELLAR.price, description: live.description ?? CONSTELLAR.description }
}

export function GameCardBody({ shown, portrait, width, bodyRef, price, description }) {
  return (
    <aside
      ref={bodyRef}
      className={`game${shown ? ' is-shown' : ''}${portrait ? ' is-portrait' : ''}`}
      style={{ width }}
      aria-hidden={!shown}
    >
      <img className="game-art" src={assetUrl(CONSTELLAR.image)} alt={CONSTELLAR.imageAlt} decoding="async" />
      <div className="game-body">
        <header className="card-head">
          <h2>{CONSTELLAR.title}</h2>
          <span className="card-index">03</span>
        </header>
        <p className="game-kicker">{CONSTELLAR.kicker}</p>
        <div className="card-text">
          <p>{description}</p>
        </div>
        <div className="game-buy">
          <p className="game-price">
            {price.discount > 0 && (
              <>
                <span className="game-discount">-{price.discount}%</span>
                <s className="game-was">{price.initial}</s>
              </>
            )}
            <strong>{price.final}</strong>
          </p>
          <a className="card-link" href={CONSTELLAR.storeUrl} target="_blank" rel="noopener noreferrer" tabIndex={shown ? 0 : -1}>
            Buy now on Steam
          </a>
        </div>
      </div>
    </aside>
  )
}
