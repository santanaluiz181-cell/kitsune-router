export function buildEyeMarkup(uid = 'k') {
  const clipRef = `url(#${uid}-eye-clip)`;
  return [
    '<g class="eye-normal"><g class="lid">',
    '<circle r="6.6" fill="#2B2E33"/><circle r="4.65" fill="#FFFFFF"/>',
    `<g clip-path="${clipRef}"><g class="pupil">`,
    '<circle r="3.75" fill="#121417"/>',
    '<circle cx="-1.25" cy="-1.2" r="1.42" fill="#FFFFFF"/>',
    '<circle cx="1.45" cy="1.38" r="0.68" fill="#FFFFFF"/>',
    '</g></g></g></g>',
    '<g class="eye-wide" style="display:none">',
    '<circle r="7.0" fill="#2B2E33"/><circle r="5.2" fill="#FFFFFF"/>',
    '<circle class="pupil-w" r="2.4" fill="#121417"/>',
    '<circle cx="-1.1" cy="-1.2" r="0.95" fill="#FFFFFF"/></g>',
    '<g class="eye-happy" style="display:none"><path d="M-4.6 1.4 Q0 -4.2 4.6 1.4" fill="none" stroke="#2B2E33" stroke-width="2.5" stroke-linecap="round"/></g>',
    '<g class="eye-wink" style="display:none"><path d="M-4.3 -1.8 L3.1 0.5 L-4.3 2.8" fill="none" stroke="#2B2E33" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></g>',
    '<g class="eye-closed" style="display:none"><path d="M-4.6 0.2 Q0 3.1 4.6 0.2" fill="none" stroke="#2B2E33" stroke-width="2.4" stroke-linecap="round"/></g>',
    '<g class="eye-line" style="display:none"><line x1="-4.6" y1="0" x2="4.6" y2="0" stroke="#2B2E33" stroke-width="2.5" stroke-linecap="round"/></g>',
    '<g class="eye-x" style="display:none"><path d="M-3.5 -3.5 L3.5 3.5 M3.5 -3.5 L-3.5 3.5" stroke="#2B2E33" stroke-width="2.5" stroke-linecap="round"/></g>',
    '<g class="eye-star" style="display:none"><polygon transform="scale(1.2)" points="0,-4.4 1.3,-1.3 4.5,-1.0 2.0,1.1 2.9,4.3 0,2.4 -2.9,4.3 -2.0,1.1 -4.5,-1.0 -1.3,-1.3" fill="#FF7D26" stroke="#2B2E33" stroke-width="0.9"/></g>',
    '<g class="eye-heart" style="display:none"><path transform="scale(1.2)" d="M0 3.2 C-4.4 0.4 -4.4 -3.2 -2.0 -3.2 C-0.8 -3.2 0 -1.9 0 -1.9 C0 -1.9 0.8 -3.2 2.0 -3.2 C4.4 -3.2 4.4 0.4 0 3.2 Z" fill="#E11D48" stroke="#2B2E33" stroke-width="0.8"/></g>',
    '<g class="eye-spiral" style="display:none"><circle r="5.6" fill="#FFF7ED" stroke="#2B2E33" stroke-width="1.5"/><path class="spiral-spin" d="M0 0 A1.35 1.35 0 0 1 1.95 0 A2.7 2.7 0 0 1 -2.45 0 A4.0 4.0 0 0 1 3.7 0" fill="none" stroke="#2B2E33" stroke-width="1.45" stroke-linecap="round"/></g>'
  ].join('');
}

function buildPropsMarkup() {
  return [
    '<g class="k-vault" transform="translate(79 30)" opacity="0">',
    '<rect width="22" height="28" rx="3" fill="#26262A" stroke="#585C63" stroke-width="2.2"/>',
    '<rect class="k-vault-glow" x="3.5" y="4" width="15" height="20" rx="1.6" fill="#FF7D26" opacity="0.28"/>',
    '<g class="k-vault-door"><rect x="2.2" y="2.8" width="17.6" height="22.4" rx="2" fill="#43464E" stroke="#18181B" stroke-width="1.5"/>',
    '<circle cx="11" cy="14" r="4.8" fill="#18181B" stroke="#FF7D26" stroke-width="1.6"/>',
    '<line x1="11" y1="9.6" x2="11" y2="18.4" stroke="#FF7D26" stroke-width="1.3"/>',
    '<line x1="6.6" y1="14" x2="15.4" y2="14" stroke="#FF7D26" stroke-width="1.3"/></g></g>',
    '<g class="k-trash" transform="translate(81 35)" opacity="0">',
    '<rect x="2" y="6" width="17" height="19" rx="2.5" fill="#3F424A" stroke="#18181B" stroke-width="2"/>',
    '<line x1="6.5" y1="10" x2="6.5" y2="21" stroke="#18181B" stroke-width="1.5" stroke-linecap="round"/>',
    '<line x1="10.5" y1="10" x2="10.5" y2="21" stroke="#18181B" stroke-width="1.5" stroke-linecap="round"/>',
    '<line x1="14.5" y1="10" x2="14.5" y2="21" stroke="#18181B" stroke-width="1.5" stroke-linecap="round"/>',
    '<g class="k-trash-lid"><rect x="0" y="2.5" width="21" height="3.6" rx="1.3" fill="#DC2626" stroke="#18181B" stroke-width="1.7"/>',
    '<rect x="7" y="0" width="7" height="2.8" rx="1" fill="#DC2626" stroke="#18181B" stroke-width="1.4"/></g></g>',
    '<g class="k-key" opacity="0" transform="translate(52 46)">',
    '<circle cx="0" cy="0" r="3.4" fill="#FF7D26" stroke="#18181B" stroke-width="1.5"/><circle cx="-0.4" cy="0" r="1.2" fill="#18181B"/>',
    '<path d="M3.2 0 L12.5 0 L12.5 3.1 M9.5 0 L9.5 2.6" fill="none" stroke="#FF7D26" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></g>'
  ].join('');
}

function buildTailAndEarsMarkup() {
  const tailD = 'M60 53.5 C71.5 53.5 76.8 45.2 77.2 33.8 C77.6 29.8 79.4 27.2 81.8 25.5 C73.2 24.4 65.2 27.6 62.2 37.0 L59.5 47.0 Z';
  const earLD = 'M20.2 28.5 C17.8 20.5 18.2 13.0 20.6 7.5 C26.6 9.8 31.8 14.4 34.8 19.6 Z';
  const earRD = 'M63.8 28.5 C66.2 20.5 65.8 13.0 63.4 7.5 C57.4 9.8 52.2 14.4 49.2 19.6 Z';
  return [
    '<g class="k-tail">',
    `<path d="${tailD}" fill="none" stroke="#585C63" stroke-width="5.2" stroke-linejoin="round"/>`,
    `<path d="${tailD}" fill="#EE7522"/>`,
    '<path d="M66.2 33.2 L69.2 36.2 L71.8 32.8 L74.6 36.6 L77.4 33.8 C77.8 30.2 79.6 27.2 81.8 25.5 C74.4 24.6 68.8 27.4 66.2 33.2 Z" fill="#FFFFFF"/>',
    `<path d="${tailD}" fill="none" stroke="#2B2E33" stroke-width="2.5" stroke-linejoin="round"/>`,
    '</g>',
    '<g class="k-earL">',
    `<path d="${earLD}" fill="none" stroke="#585C63" stroke-width="5.2" stroke-linejoin="round"/>`,
    `<path d="${earLD}" fill="#EE7522" stroke="#2B2E33" stroke-width="2.6" stroke-linejoin="round"/>`,
    '<path d="M21.8 25.5 C20.4 20.4 20.6 15.0 22.0 11.4 C25.6 13.2 29.0 16.4 31.2 20.4 Z" fill="#FAF0DE"/>',
    '</g>',
    '<g class="k-earR">',
    `<path d="${earRD}" fill="none" stroke="#585C63" stroke-width="5.2" stroke-linejoin="round"/>`,
    `<path d="${earRD}" fill="#EE7522" stroke="#2B2E33" stroke-width="2.6" stroke-linejoin="round"/>`,
    '<path d="M62.2 25.5 C63.6 20.4 63.4 15.0 62.0 11.4 C58.4 13.2 55.0 16.4 52.8 20.4 Z" fill="#FAF0DE"/>',
    '</g>'
  ].join('');
}

function buildBodyLoafMarkup() {
  const loafD = 'M33.5 19.2 C38.8 17.2 45.2 17.2 50.5 19.2 C57.5 22.4 62.5 29.5 64.5 34.4 Q67.6 37.0 67.8 39.2 C67.5 41.2 65.4 42.8 64.2 44.4 C64.2 51.6 63.8 55.8 62.4 58.6 C61.2 60.4 59.0 60.6 55.5 60.6 L28.5 60.6 C25.0 60.6 22.8 60.4 21.6 58.6 C20.2 55.8 19.8 51.6 19.8 44.4 C18.6 42.8 16.5 41.2 16.2 39.2 Q16.4 37.0 19.5 34.4 C21.5 29.5 26.5 22.4 33.5 19.2 Z';
  return [
    '<g class="k-body">',
    `<path d="${loafD}" fill="none" stroke="#585C63" stroke-width="5.2" stroke-linejoin="round"/>`,
    `<path d="${loafD}" fill="#EE7522"/>`,
    '<path d="M17.0 39.0 C22.5 36.2 27.6 36.4 32.5 37.8 C36.8 39.0 40.0 37.4 42.0 37.4 C44.0 37.4 47.2 39.0 51.5 37.8 C56.4 36.4 61.5 36.2 67.0 39.0 L63.8 44.2 C58.5 47.8 54.0 49.4 51.2 49.8 L50.8 52.8 L48.2 51.8 L47.0 54.8 L44.4 53.6 L42.0 57.0 L39.6 53.6 L37.0 54.8 L35.8 51.8 L33.2 52.8 L32.8 49.8 C30.0 49.4 25.5 47.8 20.2 44.2 Z" fill="#FFFFFF"/>',
    `<path d="${loafD}" fill="none" stroke="#2B2E33" stroke-width="2.6" stroke-linejoin="round"/>`,
    '<path d="M19.8 44.0 C24.5 48.0 30.2 49.8 34.4 50.3" fill="none" stroke="#2B2E33" stroke-width="2.3" stroke-linecap="round"/>',
    '<path d="M64.2 44.0 C59.5 48.0 53.8 49.8 49.6 50.3" fill="none" stroke="#2B2E33" stroke-width="2.3" stroke-linecap="round"/>',
    '<ellipse cx="26.0" cy="59.6" rx="5.8" ry="2.7" fill="#585C63"/>',
    '<ellipse cx="58.0" cy="59.6" rx="5.8" ry="2.7" fill="#585C63"/>',
    '<ellipse cx="26.0" cy="59.6" rx="5.0" ry="2.2" fill="#583722" stroke="#2B2E33" stroke-width="1.6"/>',
    '<ellipse cx="58.0" cy="59.6" rx="5.0" ry="2.2" fill="#583722" stroke="#2B2E33" stroke-width="1.6"/>',
    '</g>'
  ].join('');
}

function buildFaceAndCapMarkup() {
  const capDome = 'M21.6 25.8 C19.8 20.6 23.2 14.4 39.2 14.0 C52.8 13.8 58.6 18.2 58.8 22.8 C52.6 27.0 35.8 28.4 21.6 25.8 Z';
  return [
    '<g class="k-hands" opacity="0">',
    '<ellipse cx="21" cy="40" rx="4.0" ry="3.2" transform="rotate(-24 21 40)" fill="#EE7522" stroke="#2B2E33" stroke-width="1.8"/>',
    '<ellipse cx="63" cy="40" rx="4.0" ry="3.2" transform="rotate(24 63 40)" fill="#EE7522" stroke="#2B2E33" stroke-width="1.8"/></g>',
    '<g class="k-face">',
    '<ellipse class="k-cheekL" cx="24.2" cy="44.2" rx="4.1" ry="1.65" fill="#F39EA8"/>',
    '<ellipse class="k-cheekR" cx="59.8" cy="44.2" rx="4.1" ry="1.65" fill="#F39EA8"/>',
    '<g class="k-eye" data-side="L" transform="translate(31.6 33.8)"></g>',
    '<g class="k-eye" data-side="R" transform="translate(52.4 33.8)"></g>',
    '<g class="k-snout">',
    '<path d="M39.5 38.4 Q42 37.6 44.5 38.4 Q44.6 40.2 42 41.3 Q39.4 40.2 39.5 38.4 Z" fill="#2B2E33"/>',
    '<g class="k-mouth-ok"><path d="M42 41.1 L42 42.5 M38.2 42.2 C38.5 44.8 41.8 44.6 42 42.5 C42.2 44.6 45.5 44.8 45.8 42.2" fill="none" stroke="#2B2E33" stroke-width="2.0" stroke-linecap="round" stroke-linejoin="round"/></g>',
    '<path class="k-mouth-dizzy" style="display:none" d="M38.2 43.0 Q40.0 41.4 42 43.0 Q44.0 44.6 45.8 43.0" fill="none" stroke="#2B2E33" stroke-width="1.9" stroke-linecap="round"/></g></g>',
    '<g class="k-loupe" opacity="0" transform="translate(65 37)">',
    '<line x1="-1.5" y1="5" x2="-4.5" y2="11" stroke="#2B2E33" stroke-width="2.2" stroke-linecap="round"/>',
    '<circle cx="1.5" cy="0" r="6.2" fill="#38BDF8" fill-opacity="0.22" stroke="#2B2E33" stroke-width="2"/></g>',
    '<path class="k-sweat" opacity="0" d="M62 20 C64.2 23.2 64.2 26 62 27.4 C59.8 26 59.8 23.2 62 20 Z" fill="#38BDF8" stroke="#2B2E33" stroke-width="1.1"/>',
    '<g class="k-beret" style="display:none">',
    `<path d="${capDome}" fill="none" stroke="#585C63" stroke-width="4.2" stroke-linejoin="round"/>`,
    `<path d="${capDome}" fill="#1E1F24" stroke="#18181B" stroke-width="1.6" stroke-linejoin="round"/>`,
    '<ellipse cx="40.2" cy="16.4" rx="5.5" ry="1.1" fill="#464A52"/>',
    '<path d="M23.0 23.0 C22.8 18.8 31.4 16.8 41.5 17.5 C48.2 18.0 52.8 19.0 54.6 20.4 L53.2 23.6 C45.0 21.5 31.0 21.5 23.0 23.0 Z" fill="#FF7D26"/>',
    '<g transform="translate(55 15.5) rotate(17)">',
    '<rect x="-10.5" y="-4.8" width="21" height="9.6" rx="2.0" fill="#585C63" stroke="#585C63" stroke-width="1.6"/>',
    '<rect x="-9.8" y="-4.2" width="19.6" height="8.4" rx="1.6" fill="#18181B"/>',
    '<rect x="-8.6" y="-3.0" width="17.2" height="6.0" rx="1.0" fill="#FFFFFF"/>',
    '<text x="0" y="1.7" font-family="\'JetBrains Mono\',\'Consolas\',sans-serif" font-weight="900" font-size="5.3" letter-spacing="0.3" fill="#18181B" text-anchor="middle">PRESS</text></g></g>'
  ].join('');
}

export function buildKitsuneSvgMarkup(uid = 'k') {
  return [
    '<svg viewBox="2 2 104 66" role="img" aria-label="Mascote Kitsune">',
    `<defs><clipPath id="${uid}-eye-clip"><circle cx="0" cy="0" r="4.55"/></clipPath></defs>`,
    '<ellipse class="k-shadow" cx="42" cy="61.5" rx="27" ry="4.0" fill="#05070B" opacity="0.58"/>',
    buildPropsMarkup(),
    '<g class="k-ghost" opacity="0"><path d="M40 20 C36 16 36 10 42 10 C48 10 48 16 44 20 Q42 18 40 20 Z" fill="#FFFFFF" stroke="#2B2E33" stroke-width="1.1"/></g>',
    '<ellipse class="k-halo" cx="42" cy="6" rx="10" ry="2.8" fill="none" stroke="#FF7D26" stroke-width="2" opacity="0"/>',
    '<g class="k-root">',
    buildTailAndEarsMarkup(),
    buildBodyLoafMarkup(),
    buildFaceAndCapMarkup(),
    '</g>',
    '<g class="k-stars" opacity="0"></g>',
    '<g class="k-celeb" opacity="0"></g>',
    '<g class="k-zzz" opacity="0"></g>',
    '</svg>'
  ].join('');
}

export function populateSvgParticles(stars, celeb, zzz) {
  const ns = 'http://www.w3.org/2000/svg';
  const starPts = '0,-3.2 0.9,-0.9 3.3,-0.7 1.4,0.8 2.0,3.1 0,1.7 -2.0,3.1 -1.4,0.8 -3.3,-0.7 -0.9,-0.9';
  for (let i = 0; i < 3; i += 1) {
    const s = document.createElementNS(ns, 'polygon');
    s.setAttribute('points', starPts); s.setAttribute('fill', '#FF7D26'); s.setAttribute('stroke', '#18181B'); s.setAttribute('stroke-width', '0.7');
    stars.appendChild(s);
    const z = document.createElementNS(ns, 'text');
    z.textContent = i === 0 ? 'Z' : 'z'; z.setAttribute('fill', '#FF7D26'); z.setAttribute('font-size', String(7.5 - i * 1.1)); z.setAttribute('font-weight', '800');
    zzz.appendChild(z);
  }
  ['#FF7D26', '#10B981', '#FB923C', '#38BDF8', '#F472B6', '#18181B'].forEach((c, i) => {
    const p = i % 2 === 0 ? document.createElementNS(ns, 'polygon') : document.createElementNS(ns, 'circle');
    if (i % 2 === 0) p.setAttribute('points', starPts); else p.setAttribute('r', '2.1');
    p.setAttribute('fill', c); celeb.appendChild(p);
  });
}
