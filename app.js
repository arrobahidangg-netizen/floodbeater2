const statusText = document.getElementById("statusText")
const etaText = document.getElementById("etaText")
const distanceText = document.getElementById("distanceText")
const riskText = document.getElementById("riskText")
const helpList = document.getElementById("helpList")
const toast = document.getElementById("toast")

const map = L.map("map", { zoomControl: true, preferCanvas: true }).setView(
  [-8.0476, -34.877],
  13
)
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map)

const gridCols = 40
const gridRows = 28

let floodGrid = []
let blockedGrid = []
let shelters = []
let startCell = null
let endCell = null
let pathCells = []
let mode = "start"

const setStartBtn = document.getElementById("setStartBtn")
const setEndBtn = document.getElementById("setEndBtn")
const newMapBtn = document.getElementById("newMapBtn")
const recalcBtn = document.getElementById("recalcBtn")
const sendHelpBtn = document.getElementById("sendHelpBtn")

const floodLayer = L.layerGroup().addTo(map)
const sheltersLayer = L.layerGroup().addTo(map)
const pathLayer = L.layerGroup().addTo(map)
let startMarker = null
let endMarker = null
let pathLine = null

const volunteerMessages = [
  "Equipe de resgate disponível no bairro do Recife Antigo.",
  "Voluntários com barco leve próximos a Afogados.",
  "Motoristas solidários com veículos altos em Boa Viagem.",
  "Equipe de enfermagem de plantão em Casa Forte.",
  "Equipe com suporte a cadeiras de rodas em Santo Amaro."
]

const helpRequests = [
  "Pessoa com mobilidade reduzida aguardando apoio em Casa Amarela.",
  "Família com idoso acamado solicitando evacuação em Pina.",
  "Criança com deficiência visual precisa de escolta em Torre.",
  "Usuário de cadeira de rodas aguardando transporte em Iputinga.",
  "Pessoa surda precisa de acompanhamento em Campo Grande."
]

function randomBetween(min, max) {
  return Math.random() * (max - min) + min
}

function mapBounds() {
  const b = map.getBounds()
  return {
    south: b.getSouthWest().lat,
    west: b.getSouthWest().lng,
    north: b.getNorthEast().lat,
    east: b.getNorthEast().lng
  }
}

function cellBounds(x, y) {
  const b = mapBounds()
  const latStep = (b.north - b.south) / gridRows
  const lngStep = (b.east - b.west) / gridCols
  const s = b.south + y * latStep
  const n = b.south + (y + 1) * latStep
  const w = b.west + x * lngStep
  const e = b.west + (x + 1) * lngStep
  return [
    [s, w],
    [n, e]
  ]
}

function cellCenterLatLng(cell) {
  const bounds = cellBounds(cell.x, cell.y)
  const s = bounds[0][0]
  const w = bounds[0][1]
  const n = bounds[1][0]
  const e = bounds[1][1]
  return [(s + n) / 2, (w + e) / 2]
}

function generateGrid() {
  floodGrid = []
  blockedGrid = []
  floodLayer.clearLayers()
  for (let y = 0; y < gridRows; y += 1) {
    const row = []
    const blockedRow = []
    for (let x = 0; x < gridCols; x += 1) {
      const level = randomBetween(0, 1)
      row.push(level)
      const isBlocked = level > 0.85
      blockedRow.push(isBlocked)
      const bounds = cellBounds(x, y)
      let color = "#1b4f72"
      if (level > 0.85) color = "#3b3b3b"
      else if (level > 0.6) color = "#5dade2"
      else if (level > 0.4) color = "#2e86c1"
      const opacity =
        level > 0.85 ? 0.7 : level > 0.6 ? 0.5 : level > 0.4 ? 0.4 : 0.25
      L.rectangle(bounds, {
        color: color,
        weight: 0,
        fillOpacity: opacity,
        interactive: false
      }).addTo(floodLayer)
    }
    floodGrid.push(row)
    blockedGrid.push(blockedRow)
  }
}

function randomCell(avoidBlocked = true) {
  let cell = null
  while (!cell) {
    const x = Math.floor(Math.random() * gridCols)
    const y = Math.floor(Math.random() * gridRows)
    if (!avoidBlocked || !blockedGrid[y][x]) {
      cell = { x, y }
    }
  }
  return cell
}

function generateShelters() {
  shelters = []
  sheltersLayer.clearLayers()
  for (let i = 0; i < 4; i += 1) {
    const cell = randomCell(true)
    shelters.push(cell)
    const [lat, lng] = cellCenterLatLng(cell)
    L.circleMarker([lat, lng], {
      radius: 6,
      color: "#f8fafc",
      weight: 2,
      fillColor: "#f8fafc",
      fillOpacity: 0.9
    }).bindTooltip("Abrigo").addTo(sheltersLayer)
  }
}

function resetScenario() {
  generateGrid()
  generateShelters()
  startCell = randomCell(true)
  endCell = shelters[Math.floor(Math.random() * shelters.length)]
  mode = "start"
  recalculateRoute()
  const [lat, lng] = cellCenterLatLng(startCell)
  map.panTo([lat, lng])
}

function getNeighbors(cell) {
  const dirs = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 }
  ]
  return dirs
    .map((d) => ({ x: cell.x + d.x, y: cell.y + d.y }))
    .filter((n) => n.x >= 0 && n.x < gridCols && n.y >= 0 && n.y < gridRows)
    .filter((n) => !blockedGrid[n.y][n.x])
}

function costFor(cell) {
  return 1 + floodGrid[cell.y][cell.x] * 5
}

function dijkstra(start, end) {
  const distances = Array.from({ length: gridRows }, () =>
    Array.from({ length: gridCols }, () => Infinity)
  )
  const previous = Array.from({ length: gridRows }, () =>
    Array.from({ length: gridCols }, () => null)
  )
  const visited = Array.from({ length: gridRows }, () =>
    Array.from({ length: gridCols }, () => false)
  )
  const queue = []
  distances[start.y][start.x] = 0
  queue.push({ cell: start, priority: 0 })

  while (queue.length) {
    queue.sort((a, b) => a.priority - b.priority)
    const current = queue.shift()
    if (!current) break
    const { cell } = current
    if (visited[cell.y][cell.x]) continue
    visited[cell.y][cell.x] = true
    if (cell.x === end.x && cell.y === end.y) break
    for (const neighbor of getNeighbors(cell)) {
      const alt = distances[cell.y][cell.x] + costFor(neighbor)
      if (alt < distances[neighbor.y][neighbor.x]) {
        distances[neighbor.y][neighbor.x] = alt
        previous[neighbor.y][neighbor.x] = cell
        queue.push({ cell: neighbor, priority: alt })
      }
    }
  }

  const path = []
  let current = end
  while (current && !(current.x === start.x && current.y === start.y)) {
    path.push(current)
    current = previous[current.y][current.x]
  }
  if (!current) return []
  path.push(start)
  return path.reverse()
}

function recalculateRoute() {
  if (!startCell || !endCell) return
  pathCells = dijkstra(startCell, endCell)
  drawRoute()
  updateStats()
}

function drawRoute() {
  pathLayer.clearLayers()
  if (startMarker) startMarker.remove()
  if (endMarker) endMarker.remove()
  if (!pathCells.length) return
  const latlngs = pathCells.map((c) => cellCenterLatLng(c))
  pathLine = L.polyline(latlngs, {
    color: "#f7dc6f",
    weight: 5,
    opacity: 0.9
  }).addTo(pathLayer)
  const [sLat, sLng] = latlngs[0]
  const [eLat, eLng] = latlngs[latlngs.length - 1]
  startMarker = L.circleMarker([sLat, sLng], {
    radius: 7,
    color: "#22c55e",
    weight: 3,
    fillColor: "#22c55e",
    fillOpacity: 0.9
  }).addTo(pathLayer)
  endMarker = L.circleMarker([eLat, eLng], {
    radius: 7,
    color: "#ef4444",
    weight: 3,
    fillColor: "#ef4444",
    fillOpacity: 0.9
  }).addTo(pathLayer)
}

function updateStats() {
  if (!pathCells.length) {
    etaText.textContent = "Sem rota segura"
    distanceText.textContent = "—"
    riskText.textContent = "Risco alto"
    return
  }
  let distance = 0
  for (let i = 1; i < pathCells.length; i += 1) {
    const a = cellCenterLatLng(pathCells[i - 1])
    const b = cellCenterLatLng(pathCells[i])
    distance += L.latLng(a[0], a[1]).distanceTo(L.latLng(b[0], b[1]))
  }
  distance = distance / 1000
  const minutes = Math.max(5, Math.round(distance * 6))
  const critical = pathCells.filter((cell) => floodGrid[cell.y][cell.x] > 0.6).length
  etaText.textContent = `${minutes} min`
  distanceText.textContent = `${distance.toFixed(1)} km`
  riskText.textContent = critical > 6 ? "Risco moderado" : "Risco baixo"
}

function setMode(nextMode) {
  mode = nextMode
  statusText.textContent =
    mode === "start"
      ? "Clique no mapa para definir a origem"
      : "Clique no mapa para definir o destino"
}

function handleMapClick(e) {
  const b = mapBounds()
  const latStep = (b.north - b.south) / gridRows
  const lngStep = (b.east - b.west) / gridCols
  const x = Math.floor((e.latlng.lng - b.west) / lngStep)
  const y = Math.floor((e.latlng.lat - b.south) / latStep)
  if (x < 0 || y < 0 || x >= gridCols || y >= gridRows) return
  if (blockedGrid[y][x]) return
  if (mode === "start") {
    startCell = { x, y }
  } else {
    endCell = { x, y }
  }
  recalculateRoute()
}

function shuffle(array) {
  return array.sort(() => Math.random() - 0.5)
}

function populateHelpList() {
  helpList.innerHTML = ""
  const messages = shuffle([...volunteerMessages, ...helpRequests]).slice(0, 5)
  for (const msg of messages) {
    const li = document.createElement("li")
    li.textContent = msg
    helpList.appendChild(li)
  }
}

function showToast(message) {
  toast.textContent = message
  toast.classList.remove("hidden")
  setTimeout(() => {
    toast.classList.add("hidden")
  }, 2600)
}

map.on("click", handleMapClick)
setStartBtn.addEventListener("click", () => setMode("start"))
setEndBtn.addEventListener("click", () => setMode("end"))
newMapBtn.addEventListener("click", () => {
  resetScenario()
  populateHelpList()
  showToast("Mapa atualizado e alertas renovados.")
})
recalcBtn.addEventListener("click", recalculateRoute)
sendHelpBtn.addEventListener("click", () => {
  showToast("Alerta solidário enviado para voluntários próximos.")
  populateHelpList()
})

resetScenario()
populateHelpList()
setMode("start")
