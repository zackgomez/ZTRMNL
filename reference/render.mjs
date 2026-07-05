import satori from 'satori'
import { html } from 'satori-html'
import { Resvg } from '@resvg/resvg-js'
import sharp from 'sharp'
import { readFileSync, writeFileSync } from 'node:fs'

const fontRegular = readFileSync('/usr/share/fonts/TTF/DejaVuSans.ttf')
const fontBold = readFileSync('/usr/share/fonts/TTF/DejaVuSans-Bold.ttf')
const d = JSON.parse(readFileSync(new URL('./nas.json', import.meta.url)))

// Port of nas_template.html. Satori requires explicit display:flex on any
// element with multiple children; flex-direction defaults to row.
const col = 'display:flex;flex-direction:column;'
const minify = s => s.replace(/>\s+</g, '><').trim()
const markup = () => html(minify(`
<div style="height:480px;width:800px;padding:20px 32px;${col}justify-content:space-between;font-family:'DejaVu Sans';background:#fff;color:#000;">

  <div style="${col}">
    <div style="${col}margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <span style="font-size:34px;font-weight:700;">tank</span>
        <span style="font-size:36px;font-weight:700;">${d.tank_pct}%</span>
      </div>
      <div style="display:flex;height:34px;border:2px solid #000;border-radius:5px;overflow:hidden;margin:4px 0;">
        <div style="display:flex;height:100%;width:${d.tank_pct}%;background:#888;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:18px;">
        <span>${d.tank_used} / ${d.tank_total}</span>
        <span>${d.tank_health} · frag ${d.tank_frag}</span>
      </div>
    </div>

    <div style="${col}">
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <span style="font-size:34px;font-weight:700;">fastpool</span>
        <span style="font-size:36px;font-weight:700;">${d.fastpool_pct}%</span>
      </div>
      <div style="display:flex;height:34px;border:2px solid #000;border-radius:5px;overflow:hidden;margin:4px 0;">
        <div style="display:flex;height:100%;width:${d.fastpool_pct}%;background:#888;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:18px;">
        <span>${d.fastpool_used} / ${d.fastpool_total}</span>
        <span>${d.fastpool_health} · frag ${d.fastpool_frag}</span>
      </div>
    </div>
  </div>

  <div style="display:flex;justify-content:space-between;border-top:2px solid #000;border-bottom:2px solid #000;padding:16px 0;">
    <div style="flex:1;${col}align-items:center;padding:0 10px;">
      <div style="font-size:48px;font-weight:700;line-height:1;">${d.load1}</div>
      <div style="font-size:19px;margin-top:6px;">load 1m</div>
      <div style="font-size:16px;">${d.load5} / ${d.load15}</div>
    </div>
    <div style="flex:1;${col}align-items:center;padding:0 10px;border-left:2px solid #888;">
      <div style="font-size:48px;font-weight:700;line-height:1;">${d.mem_pct}%</div>
      <div style="font-size:19px;margin-top:6px;">memory</div>
      <div style="font-size:16px;">${d.ncpus} cores</div>
    </div>
    <div style="flex:1;${col}align-items:center;padding:0 10px;border-left:2px solid #888;">
      <div style="display:flex;align-items:baseline;font-weight:700;line-height:1;">
        <span style="font-size:48px;">${d.cpu_w}</span><span style="font-size:26px;">W</span>
      </div>
      <div style="font-size:19px;margin-top:6px;">CPU power</div>
      <div style="font-size:16px;">${d.cpu_w_avg}W avg/1h</div>
    </div>
    <div style="flex:1;${col}align-items:center;justify-content:center;padding:0 10px;border-left:2px solid #888;">
      <div style="font-size:40px;line-height:1;">${d.internet === 'up' ? '●' : '○'}</div>
      <div style="font-size:19px;margin-top:8px;">internet ${d.internet}</div>
    </div>
  </div>

  <div style="display:flex;justify-content:space-between;font-size:22px;font-weight:700;">
    <span>NAS</span>
    <span>up ${d.uptime_d} · ${d.updated}</span>
  </div>

</div>`))

const fonts = [
  { name: 'DejaVu Sans', data: fontRegular, weight: 400, style: 'normal' },
  { name: 'DejaVu Sans', data: fontBold, weight: 700, style: 'normal' },
]

async function render() {
  const svg = await satori(markup(), { width: 800, height: 480, fonts })
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 800 } }).render().asPng()
  // quantize: grayscale, 4-color palette (matches og_plus 2-bit / 4 grays)
  const out = await sharp(png).flatten({ background: '#fff' }).grayscale()
    .png({ palette: true, colours: 4 }).toBuffer()
  return { svg, png, out }
}

// cold
let t0 = performance.now()
const first = await render()
const cold = performance.now() - t0

// warm ×10
const times = []
for (let i = 0; i < 10; i++) {
  t0 = performance.now()
  await render()
  times.push(performance.now() - t0)
}

writeFileSync('out-full.png', first.png)
writeFileSync('out-2bit.png', first.out)
times.sort((a, b) => a - b)
console.log(`cold (first render): ${cold.toFixed(1)} ms`)
console.log(`warm ×10: min ${times[0].toFixed(1)}  median ${times[5].toFixed(1)}  max ${times[9].toFixed(1)} ms`)
console.log(`sizes: full ${first.png.length} B, 2-bit ${first.out.length} B`)
