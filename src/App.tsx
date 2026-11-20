import { useEffect, useState, useRef } from 'react'
import * as ROSLIB from 'roslib'
import './App.css'

type CameraMode = 'combined' | 'nav' | 'arm'

interface MarkerPoint {
  x: number
  y: number
}

interface BuoyMarker {
  id: number
  x: number
  y: number
  color: string
}

interface VisionStatsEntry {
  count: number
  max_conf: number
  detected: boolean
}

const VISION_KEYS = [
  'cargo_cube',
  'cargo_sphere',
  'cargo_prism',
  'buoy_green',
  'buoy_red',
  'buoy_yellow',
  'buoy_black',
  'docking_slot',
  'spot2_banner',
]

const DEFAULT_VRX_BUOYS: BuoyMarker[] = [
  { id: 1, x: -30, y: 8, color: '#2ec759' },
  { id: 2, x: -30, y: -2, color: '#e0382e' },
  { id: 3, x: -15, y: 8.75, color: '#2ec759' },
  { id: 4, x: -15, y: -8.75, color: '#e0382e' },
  { id: 5, x: 0, y: 0.75, color: '#2ec759' },
  { id: 6, x: 0, y: -6.75, color: '#e0382e' },
  { id: 7, x: 15, y: 8.75, color: '#2ec759' },
  { id: 8, x: 15, y: -8.75, color: '#e0382e' },
  { id: 9, x: 30, y: 8, color: '#2ec759' },
  { id: 10, x: 30, y: -2, color: '#e0382e' },
  { id: 11, x: -22.5, y: 4, color: '#f5c72e' },
  { id: 12, x: -7.5, y: -4.375, color: '#3b424c' },
  { id: 13, x: 7.5, y: 0.625, color: '#3b424c' },
  { id: 14, x: 22.5, y: -1, color: '#f5c72e' },
]

const LS_WS_KEY = 'nala_ws_url'
const LS_VIDEO_KEY = 'nala_video_url'

function isLocalHostName(hostname: string): boolean {
  if (!hostname) return true
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.local')
  ) {
    return true
  }
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)
}

function getDefaultBridgeConfig(): { wsUrl: string; videoBaseUrl: string } {
  const envWs = import.meta.env.VITE_WS_URL?.trim()
  const envVideo = import.meta.env.VITE_VIDEO_BASE_URL?.trim()
  const rawHost =
    typeof window !== 'undefined' && window.location.hostname
      ? window.location.hostname
      : 'localhost'
  const host = isLocalHostName(rawHost) ? rawHost : 'localhost'
  return {
    wsUrl: envWs || `ws://${host}:9090`,
    videoBaseUrl: (envVideo || `http://${host}:8081`).replace(/\/+$/, ''),
  }
}

function getInitialBridgeConfig(): { wsUrl: string; videoBaseUrl: string } {
  const defaults = getDefaultBridgeConfig()
  if (typeof window === 'undefined') return defaults

  const params = new URLSearchParams(window.location.search)
  const qHost = params.get('host')?.trim()
  const qWs = params.get('ws')?.trim()
  const qVideo = params.get('video')?.trim()

  if (qWs || qVideo || qHost) {
    const wsUrl = qWs || (qHost ? `ws://${qHost}:9090` : defaults.wsUrl)
    const videoBaseUrl = (
      qVideo || (qHost ? `http://${qHost}:8081` : defaults.videoBaseUrl)
    ).replace(/\/+$/, '')
    try {
      window.localStorage.setItem(LS_WS_KEY, wsUrl)
      window.localStorage.setItem(LS_VIDEO_KEY, videoBaseUrl)
    } catch {
      // ignore storage errors
    }
    return { wsUrl, videoBaseUrl }
  }

  try {
    const savedWs = window.localStorage.getItem(LS_WS_KEY)?.trim()
    const savedVideo = window.localStorage.getItem(LS_VIDEO_KEY)?.trim()
    return {
      wsUrl: savedWs || defaults.wsUrl,
      videoBaseUrl: (savedVideo || defaults.videoBaseUrl).replace(/\/+$/, ''),
    }
  } catch {
    return defaults
  }
}

function App() {
  const rosRef = useRef<ROSLIB.Ros | null>(null)
  const [bridgeConfig, setBridgeConfig] = useState(getInitialBridgeConfig)
  const [showBridgeModal, setShowBridgeModal] = useState(false)
  const [draftWsUrl, setDraftWsUrl] = useState(bridgeConfig.wsUrl)
  const [draftVideoUrl, setDraftVideoUrl] = useState(bridgeConfig.videoBaseUrl)

  const wsUrl = bridgeConfig.wsUrl
  const videoBaseUrl = bridgeConfig.videoBaseUrl

  const [connected, setConnected] = useState(false)
  const [missionStatus, setMissionStatus] = useState('WAITING')
  const [battery, setBattery] = useState<number | null>(null)
  const [voltage, setVoltage] = useState<number | null>(null)
  const [position, setPosition] = useState<{
    x: number | null
    y: number | null
    yawDeg: number | null
    speed: number | null
  }>({ x: null, y: null, yawDeg: null, speed: null })

  const [activity, setActivity] = useState<string[]>([])
  const [ftpScore, setFtpScore] = useState<string | null>(null)
  const [routePoints, setRoutePoints] = useState<MarkerPoint[]>([])
  const [plannedPoints, setPlannedPoints] = useState<MarkerPoint[]>([])
  const [buoyMarkers, setBuoyMarkers] = useState<BuoyMarker[]>([])

  const [cameraMode, setCameraMode] = useState<CameraMode>('combined')
  const [mjpegAvailable, setMjpegAvailable] = useState(false)
  const [mjpegSource, setMjpegSource] = useState<string>('waiting')
  const [streamFps, setStreamFps] = useState<number>(0)
  const [overviewLive, setOverviewLive] = useState(false)
  const [overviewFps, setOverviewFps] = useState<number>(0)
  const [overviewRosImg, setOverviewRosImg] = useState<string | null>(null)
  const [rosImgSrc, setRosImgSrc] = useState<string | null>(null)
  const [mlMode, setMlMode] = useState<string>('WAITING')
  const [gateErrDeg, setGateErrDeg] = useState<number | null>(null)
  const [obsAvoidDeg, setObsAvoidDeg] = useState<number | null>(null)
  const [visionPct, setVisionPct] = useState<number>(0)
  const [visionStats, setVisionStats] = useState<Record<string, VisionStatsEntry>>({})

  const [cargo, setCargo] = useState<number | null>(null)
  const [placedCargo, setPlacedCargo] = useState<number | null>(null)
  const [totalCargo, setTotalCargo] = useState<number | null>(null)
  const [collisions, setCollisions] = useState<number | null>(null)
  const [killSwitch, setKillSwitch] = useState('UNKNOWN')
  const [simBusy, setSimBusy] = useState<'idle' | 'starting' | 'resetting'>('idle')
  const [simToast, setSimToast] = useState<string | null>(null)

  const isVrxCoords =
    (position.x !== null && (position.x < -1 || position.x > 26)) ||
    (position.y !== null && (position.y < -1 || position.y > 14)) ||
    buoyMarkers.some((b) => b.x < 0 || b.x > 26) ||
    (position.x === null && buoyMarkers.length === 0)

  const spot =
    position.x === null || position.y === null
      ? null
      : isVrxCoords
        ? position.x <= -44.0 && Math.abs(position.y) <= 6.0
          ? 'Spot 1'
          : position.x >= 44.0 && Math.abs(position.y) <= 6.0
            ? 'Spot 2'
            : 'Dalam Perjalanan'
        : position.x >= 1.5 && position.x <= 3.0 && position.y >= 5.4 && position.y <= 6.6
          ? 'Spot 1'
          : position.x >= 21.0 && position.x <= 22.5 && position.y >= 5.4 && position.y <= 6.6
            ? 'Spot 2'
            : 'Dalam Perjalanan'

  useEffect(() => {
    let active = true
    const checkHealth = async () => {
      try {
        const res = await fetch(`${videoBaseUrl}/health`, { cache: 'no-store' })
        if (!res.ok) throw new Error('health not ok')
        const data = await res.json()
        if (!active) return
        const live =
          cameraMode === 'combined'
            ? Boolean(data.combined_live)
            : cameraMode === 'nav'
              ? Boolean(data.nav_live)
              : Boolean(data.arm_live)
        setMjpegAvailable(live)
        setMjpegSource(data.source || 'waiting')
        setStreamFps(typeof data.fps === 'number' ? data.fps : 0)
        setOverviewLive(Boolean(data.overview_live))
        setOverviewFps(typeof data.overview_fps === 'number' ? data.overview_fps : 0)
      } catch {
        if (!active) return
        setMjpegAvailable(false)
        setMjpegSource('waiting')
        setOverviewLive(false)
      }
    }
    checkHealth()
    const id = window.setInterval(checkHealth, 2000)
    return () => {
      active = false
      window.clearInterval(id)
    }
  }, [videoBaseUrl, cameraMode])

  useEffect(() => {
    let reconnectTimer: number | null = null
    let disposed = false

    const connect = () => {
      if (disposed) return
      const ros = new ROSLIB.Ros({ url: wsUrl })
      rosRef.current = ros

      ros.on('connection', () => {
        setConnected(true)
      })

      ros.on('error', () => {
        setConnected(false)
      })

      ros.on('close', () => {
        setConnected(false)
        if (!disposed) {
          reconnectTimer = window.setTimeout(connect, 3000)
        }
      })

      const missionTopic = new ROSLIB.Topic({
        ros,
        name: '/mission_state',
        messageType: 'std_msgs/msg/String',
      })
      missionTopic.subscribe((message: { data: string }) => {
        const state = message.data.toUpperCase()
        setMissionStatus(state)
        setKillSwitch(state === 'ESTOP' ? 'ACTIVE' : 'INACTIVE')
      })

      const batteryTopic = new ROSLIB.Topic({
        ros,
        name: '/asv/battery',
        messageType: 'sensor_msgs/msg/BatteryState',
      })
      batteryTopic.subscribe((message: { percentage: number; voltage?: number }) => {
        if (Number.isFinite(message.percentage)) {
          setBattery(Math.round(message.percentage * 100))
        }
        if (typeof message.voltage === 'number' && Number.isFinite(message.voltage)) {
          setVoltage(message.voltage)
        }
      })

      const odomTopic = new ROSLIB.Topic({
        ros,
        name: '/asv/odom',
        messageType: 'nav_msgs/msg/Odometry',
      })
      odomTopic.subscribe(
        (message: {
          pose: {
            pose: {
              position: { x: number; y: number }
              orientation?: { x: number; y: number; z: number; w: number }
            }
          }
          twist?: {
            twist?: {
              linear?: { x: number; y: number }
            }
          }
        }) => {
          const p = message.pose.pose.position
          const q = message.pose.pose.orientation
          let yawDeg: number | null = null
          if (q) {
            const siny = 2 * (q.w * q.z + q.x * q.y)
            const cosy = 1 - 2 * (q.y * q.y + q.z * q.z)
            yawDeg = (Math.atan2(siny, cosy) * 180) / Math.PI
          }
          const lin = message.twist?.twist?.linear
          const speed = lin ? Math.hypot(lin.x || 0, lin.y || 0) : null
          setPosition({ x: p.x, y: p.y, yawDeg, speed })
        }
      )

      const eventsTopic = new ROSLIB.Topic({
        ros,
        name: '/mission/events',
        messageType: 'std_msgs/msg/String',
      })
      eventsTopic.subscribe((message: { data: string }) => {
        try {
          const eventData = JSON.parse(message.data)
          const eventNames: Record<string, string> = {
            start: 'Mission started',
            stop: 'Mission stopped',
            reset: 'Mission reset',
            estop: 'Emergency stop activated',
            pick: 'Cargo picked up',
            place: 'Cargo delivered',
            gate_pass: 'Gate cleared',
            collision: 'Collision detected',
            docked: 'Arrived at Spot 2 dock',
            buzzer_spray: 'Buzzer & Water Spray activated',
            ftp_end: 'FTP attempt completed',
            mission_done: 'Mission completed',
          }
          const eventName =
            eventNames[eventData.event] ?? eventData.event ?? 'Unknown event'
          const timeStr =
            typeof eventData.t === 'number' ? `${eventData.t.toFixed(1)}s` : ''
          const details: string[] = []
          if (eventData.status) details.push(`Status: ${eventData.status}`)
          if (eventData.score !== undefined) details.push(`Score: ${eventData.score}`)
          if (eventData.collisions !== undefined) {
            details.push(`Collisions: ${eventData.collisions}`)
          }
          if (eventData.reason) details.push(`Reason: ${eventData.reason}`)
          const formattedEvent = [timeStr, eventName, ...details]
            .filter(Boolean)
            .join(' — ')
          setActivity((prev) => [formattedEvent, ...prev].slice(0, 25))
        } catch {
          setActivity((prev) => [message.data, ...prev].slice(0, 25))
        }
      })

      const scoreTopic = new ROSLIB.Topic({
        ros,
        name: '/ftp/score',
        messageType: 'std_msgs/msg/String',
      })
      scoreTopic.subscribe((message: { data: string }) => {
        try {
          const result = JSON.parse(message.data)
          setFtpScore(JSON.stringify(result, null, 2))
        } catch {
          setFtpScore(message.data)
        }
      })

      const markersTopic = new ROSLIB.Topic({
        ros,
        name: '/arena/markers',
        messageType: 'visualization_msgs/msg/MarkerArray',
      })
      markersTopic.subscribe(
        (message: {
          markers: {
            ns: string
            id?: number
            points?: MarkerPoint[]
            text?: string
            pose?: { position: { x: number; y: number } }
            color?: { r: number; g: number; b: number }
          }[]
        }) => {
          const trail = message.markers.find((m) => m.ns === 'jejak')
          if (trail?.points) {
            setRoutePoints(trail.points.map((pt) => ({ x: pt.x, y: pt.y })))
          }

          const plan = message.markers.find((m) => m.ns === 'rencana')
          if (plan?.points) {
            setPlannedPoints(plan.points.map((pt) => ({ x: pt.x, y: pt.y })))
          }

          const buoys = message.markers
            .filter((m) => m.ns === 'buoy' && m.pose?.position)
            .map((m, idx) => {
              const r = Math.round((m.color?.r ?? 0.5) * 255)
              const g = Math.round((m.color?.g ?? 0.5) * 255)
              const b = Math.round((m.color?.b ?? 0.5) * 255)
              return {
                id: m.id ?? idx,
                x: m.pose!.position.x,
                y: m.pose!.position.y,
                color: `rgb(${r},${g},${b})`,
              }
            })
          if (buoys.length > 0) {
            setBuoyMarkers(buoys)
          }

          const statusMarker = message.markers.find((m) => m.ns === 'status')
          if (statusMarker?.text) {
            const text = statusMarker.text
            const cargoMatch = text.match(/bawa (\d+)/)
            const placedMatch = text.match(/di Spot 2: (\d+)\/(\d+)/)
            const collisionMatch = text.match(/tabrakan (\d+)/)
            if (cargoMatch) setCargo(Number(cargoMatch[1]))
            if (placedMatch) {
              setPlacedCargo(Number(placedMatch[1]))
              setTotalCargo(Number(placedMatch[2]))
            }
            if (collisionMatch) setCollisions(Number(collisionMatch[1]))
          }
        }
      )

      const visionStatusTopic = new ROSLIB.Topic({
        ros,
        name: '/nala/vision/disruptive_status',
        messageType: 'std_msgs/msg/String',
      })
      visionStatusTopic.subscribe((message: { data: string }) => {
        try {
          const d = JSON.parse(message.data)
          if (d.ml_mode) setMlMode(d.ml_mode)
          if (typeof d.gate_err_deg === 'number') setGateErrDeg(d.gate_err_deg)
          if (typeof d.obs_avoid_deg === 'number') setObsAvoidDeg(d.obs_avoid_deg)
          if (typeof d.completed_percent === 'number') setVisionPct(d.completed_percent)
          if (d.stats) setVisionStats(d.stats)
          if (typeof d.fps_nav === 'number' && d.fps_nav > 0) setStreamFps(d.fps_nav)
        } catch {
          return
        }
      })

      const camCmpTopic = new ROSLIB.Topic({
        ros,
        name: '/nala/vision/image_combined/compressed',
        messageType: 'sensor_msgs/msg/CompressedImage',
        throttle_rate: 120,
      })
      camCmpTopic.subscribe((message: { data: string }) => {
        if (message.data) {
          setRosImgSrc(`data:image/jpeg;base64,${message.data}`)
        }
      })

      const overviewCmpTopic = new ROSLIB.Topic({
        ros,
        name: '/overview_camera/image/compressed',
        messageType: 'sensor_msgs/msg/CompressedImage',
        throttle_rate: 150,
      })
      overviewCmpTopic.subscribe((message: { data: string }) => {
        if (message.data) {
          setOverviewRosImg(`data:image/jpeg;base64,${message.data}`)
        }
      })
    }

    connect()

    return () => {
      disposed = true
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer)
      if (rosRef.current) {
        rosRef.current.close()
        rosRef.current = null
      }
    }
  }, [wsUrl])

  const handleKillSwitch = () => {
    const ros = rosRef.current
    if (!connected || !ros) {
      alert('ROS 2 belum terhubung!')
      return
    }
    const confirmed = window.confirm(
      'Aktifkan EMERGENCY STOP? Kapal pada simulasi akan dihentikan.'
    )
    if (!confirmed) return

    const estopService = new ROSLIB.Service({
      ros,
      name: '/estop',
      serviceType: 'std_srvs/srv/Trigger',
    })
    estopService.callService(
      {},
      (response: { success: boolean; message: string }) => {
        if (response.success) {
          setKillSwitch('ACTIVE')
          setMissionStatus('ESTOP')
          alert(response.message)
        } else {
          alert('E-STOP gagal: ' + response.message)
        }
      }
    )
  }

  const handleResetEstop = () => {
    const ros = rosRef.current
    if (!connected || !ros) return
    const resetService = new ROSLIB.Service({
      ros,
      name: '/mission/reset',
      serviceType: 'std_srvs/srv/Trigger',
    })
    resetService.callService(
      {},
      (response: { success: boolean; message: string }) => {
        if (response.success) {
          setKillSwitch('INACTIVE')
          alert(response.message)
        }
      }
    )
  }

  const handleStartSimulation = () => {
    const ros = rosRef.current
    if (!connected || !ros) {
      alert('ROS 2 belum terhubung!')
      return
    }
    setSimBusy('starting')
    setSimToast('Memulai simulasi Vision ML & Control...')
    const srv = new ROSLIB.Service({
      ros,
      name: '/sim/start',
      serviceType: 'std_srvs/srv/Trigger',
    })
    srv.callService({}, (response: { success: boolean; message: string }) => {
      setSimBusy('idle')
      setSimToast(response.message || (response.success ? 'Simulasi dimulai!' : 'Gagal memulai simulasi'))
      window.setTimeout(() => setSimToast(null), 5000)
    })
  }

  const handleResetSimulation = () => {
    const ros = rosRef.current
    if (!connected || !ros) {
      alert('ROS 2 belum terhubung!')
      return
    }
    const confirmed = window.confirm(
      'Reset simulasi? Misi yang sedang berjalan akan dihentikan dan WAM-V beserta 3 cargo akan dikembalikan ke Spot 1.'
    )
    if (!confirmed) return
    setSimBusy('resetting')
    setSimToast('Mereset WAM-V & 3 Cargo ke Spot 1...')
    const srv = new ROSLIB.Service({
      ros,
      name: '/sim/reset',
      serviceType: 'std_srvs/srv/Trigger',
    })
    srv.callService({}, (response: { success: boolean; message: string }) => {
      setSimBusy('idle')
      if (response.success) {
        setKillSwitch('INACTIVE')
        setMissionStatus('IDLE')
        setRoutePoints([])
        setPlannedPoints([])
        setFtpScore(null)
      }
      setSimToast(response.message || 'Simulasi di-reset.')
      window.setTimeout(() => setSimToast(null), 5000)
    })
  }

  const statusDescriptions: Record<string, string> = {
    IDLE: 'Waiting for mission to start',
    TRANSIT: 'Vessel is navigating FTP gates via YOLOv8 Visual Servoing + A*',
    FTP_KE_SPOT2: 'Vessel is navigating FTP gates toward Spot 2',
    RUNNING: 'Mission task (Cargo Pick / Unload & Spray) is currently running',
    DONE: 'Mission completed — all cargo delivered & Spot 2 docked',
    ESTOP: 'Emergency stop is active — thrusters cut off',
  }

  const status = missionStatus.toUpperCase()

  const toSvg = (wx: number, wy: number) => {
    if (isVrxCoords) {
      const sx = 40 + ((wx + 60) / 120) * 680
      const sy = 150 - (wy / 30) * 125
      return {
        x: Math.max(20, Math.min(740, sx)),
        y: Math.max(20, Math.min(280, sy)),
      }
    }
    const sx = 40 + (wx / 24) * 680
    const sy = 270 - (wy / 12) * 240
    return {
      x: Math.max(20, Math.min(740, sx)),
      y: Math.max(20, Math.min(280, sy)),
    }
  }

  const spot1Svg = isVrxCoords ? toSvg(-48.75, 0) : toSvg(2.25, 6)
  const spot2Svg = isVrxCoords ? toSvg(48.75, 0) : toSvg(21.75, 6)
  const vesselSvg =
    position.x !== null && position.y !== null
      ? toSvg(position.x, position.y)
      : null
  const displayBuoys =
    buoyMarkers.length > 0 ? buoyMarkers : isVrxCoords ? DEFAULT_VRX_BUOYS : []

  const hasLiveVideo = mjpegAvailable || rosImgSrc !== null
  const streamUrl = `${videoBaseUrl}/stream/${cameraMode}`
  const cameraOverlayLabel =
    cameraMode === 'combined'
      ? 'DUAL VIEW · CAM-NAV + CAM-ARM (OPENCV YOLOv8)'
      : cameraMode === 'nav'
        ? 'CAM-NAV · YOLOv8 GATE & OBSTACLE'
        : 'CAM-ARM · CARGO DETECTION'

  const openBridgeModal = () => {
    setDraftWsUrl(wsUrl)
    setDraftVideoUrl(videoBaseUrl)
    setShowBridgeModal(true)
  }

  const applyBridgeConfig = (nextWs: string, nextVideo: string) => {
    const cleanWs = nextWs.trim()
    const cleanVideo = nextVideo.trim().replace(/\/+$/, '')
    if (!cleanWs || !cleanVideo) return
    try {
      window.localStorage.setItem(LS_WS_KEY, cleanWs)
      window.localStorage.setItem(LS_VIDEO_KEY, cleanVideo)
    } catch {
      // ignore storage errors
    }
    setRosImgSrc(null)
    setOverviewRosImg(null)
    setBridgeConfig({ wsUrl: cleanWs, videoBaseUrl: cleanVideo })
    setShowBridgeModal(false)
  }

  const resetBridgeConfig = () => {
    try {
      window.localStorage.removeItem(LS_WS_KEY)
      window.localStorage.removeItem(LS_VIDEO_KEY)
    } catch {
      // ignore storage errors
    }
    const defaults = getDefaultBridgeConfig()
    setDraftWsUrl(defaults.wsUrl)
    setDraftVideoUrl(defaults.videoBaseUrl)
    setRosImgSrc(null)
    setOverviewRosImg(null)
    setBridgeConfig(defaults)
    setShowBridgeModal(false)
  }

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">N</div>
          <div>
            <h2>NALA</h2>
            <span>MISSION CONTROL</span>
          </div>
        </div>

        <nav className="navigation">
          <p className="nav-label">MAIN MENU</p>
          <a className="nav-item active" href="#overview">▦ Overview</a>
          <a className="nav-item" href="#camera">▣ Camera View</a>
          <a className="nav-item" href="#overview-cam">◈ Arena Top View</a>
          <a className="nav-item" href="#map">⌖ Mission Map</a>
          <a className="nav-item" href="#telemetry">⌁ Live Telemetry</a>
          <a className="nav-item" href="#activity">◷ Activity Log</a>
        </nav>

        <button
          type="button"
          className="sidebar-bottom sidebar-bottom-btn"
          onClick={openBridgeModal}
          title="Configure ROS Bridge & Video Stream URLs"
        >
          <span
            className="connection-dot"
            style={{
              background: connected ? '#22c55e' : '#e7b65e',
            }}
          />
          <div>
            <strong>ROS 2 CONNECTION</strong>
            <small>{connected ? 'Connected · Live Data' : 'Reconnecting...'}</small>
          </div>
        </button>
      </aside>

      <main className="main-content" id="overview">
        <header className="topbar">
          <div>
            <p className="eyebrow">AUTONOMOUS SURFACE VEHICLE · NALA 16</p>
            <h1>Mission Dashboard</h1>
          </div>
          <div className="topbar-right">
            <button
              type="button"
              className="bridge-btn"
              onClick={openBridgeModal}
              title={`WS: ${wsUrl} | Video: ${videoBaseUrl}`}
            >
              ⚙ BRIDGE URL
            </button>
            <span className="demo-label">
              {connected ? 'LIVE MODE' : 'OFFLINE'}
            </span>
            <span className="operator">OPERATOR</span>
          </div>
        </header>

        <section className="mission-section" id="mission">
          <div>
            <p className="section-label">CURRENT MISSION STATUS</p>
            <h2>{status}</h2>
            <p className="muted">
              {simToast || statusDescriptions[status] || 'Waiting for mission data'}
            </p>
          </div>

          <div className="mission-right">
            <div className="sim-actions">
              <button
                type="button"
                className="sim-btn start"
                onClick={handleStartSimulation}
                disabled={!connected || simBusy !== 'idle'}
              >
                {simBusy === 'starting' ? '⏳ STARTING...' : '▶ START SIMULATION'}
              </button>
              <button
                type="button"
                className="sim-btn reset"
                onClick={handleResetSimulation}
                disabled={!connected || simBusy !== 'idle'}
              >
                {simBusy === 'resetting' ? '⏳ RESETTING...' : '↺ RESET SIMULATION'}
              </button>
            </div>
            <div className="status-list">
              {['IDLE', 'RUNNING', 'TRANSIT', 'DONE', 'ESTOP'].map((item) => (
                <span
                  key={item}
                  className={`status ${status === item ? 'idle' : ''}`}
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="camera-card" id="camera">
          <div className="card-heading">
            <div>
              <p className="section-label">VISUAL MONITORING · OPENCV YOLOv8</p>
              <h3>Camera View</h3>
            </div>
            <div className="camera-controls">
              <button
                type="button"
                className={`cam-btn ${cameraMode === 'combined' ? 'active' : ''}`}
                onClick={() => setCameraMode('combined')}
              >
                DUAL VIEW
              </button>
              <button
                type="button"
                className={`cam-btn ${cameraMode === 'nav' ? 'active' : ''}`}
                onClick={() => setCameraMode('nav')}
              >
                CAM-NAV
              </button>
              <button
                type="button"
                className={`cam-btn ${cameraMode === 'arm' ? 'active' : ''}`}
                onClick={() => setCameraMode('arm')}
              >
                CAM-ARM
              </button>
              <span
                className={`feed-status ${
                  mjpegAvailable
                    ? mjpegSource === 'ml_vision'
                      ? 'live'
                      : 'raw'
                    : rosImgSrc
                      ? 'live'
                      : ''
                }`}
              >
                {mjpegAvailable
                  ? mjpegSource === 'ml_vision'
                    ? `● LIVE OPENCV${streamFps > 0 ? ` · ${streamFps.toFixed(1)} FPS` : ''}`
                    : '● LIVE RAW VRX'
                  : rosImgSrc
                    ? '● LIVE ROS STREAM'
                    : '● NO SIGNAL'}
              </span>
            </div>
          </div>

          <div className="camera-screen">
            {hasLiveVideo ? (
              <img
                key={mjpegAvailable ? streamUrl : 'ros-fallback'}
                src={mjpegAvailable ? streamUrl : (rosImgSrc ?? '')}
                alt="NALA 16 OpenCV Vision Monitor"
                className="camera-stream-img"
              />
            ) : (
              <div className="camera-placeholder">
                <span className="camera-icon">▣</span>
                <h3>OPENCV VISION FEED</h3>
                <p>Waiting for ./jalankan_misi_vision_ml.sh or VRX cameras</p>
                <small>
                  Live Dual-Camera OpenCV (CAM-NAV + CAM-ARM) will appear here
                </small>
              </div>
            )}
            <span className="camera-overlay">{cameraOverlayLabel}</span>
          </div>

          <div className="vision-hud">
            <div className="vision-metrics">
              <span>
                ML Mode: <strong>{mlMode}</strong>
              </span>
              <span>
                Gate Err:{' '}
                <strong>
                  {gateErrDeg !== null ? `${gateErrDeg >= 0 ? '+' : ''}${gateErrDeg.toFixed(1)}°` : '--'}
                </strong>
              </span>
              <span>
                Obs Avoid:{' '}
                <strong>
                  {obsAvoidDeg !== null ? `${obsAvoidDeg >= 0 ? '+' : ''}${obsAvoidDeg.toFixed(1)}°` : '--'}
                </strong>
              </span>
              <span>
                Vision Coverage: <strong>{visionPct}%</strong>
              </span>
            </div>
            <div className="vision-badges">
              {VISION_KEYS.map((key) => {
                const entry = visionStats[key]
                const ok = Boolean(entry?.detected)
                return (
                  <span key={key} className={`vision-pill ${ok ? 'detected' : ''}`}>
                    {ok ? '✓ ' : '○ '}
                    {key}
                    {ok && entry.max_conf > 0
                      ? ` ${(entry.max_conf * 100).toFixed(0)}%`
                      : ''}
                  </span>
                )
              })}
            </div>
          </div>
        </section>

        <section className="camera-card map-card" id="overview-cam">
          <div className="card-heading">
            <div>
              <p className="section-label">ARENA OVERHEAD CAMERA · /overview_camera/image</p>
              <h3>Arena Top-Down View</h3>
            </div>
            <span className={`feed-status ${overviewLive || overviewRosImg ? 'live' : ''}`}>
              {overviewLive
                ? `● LIVE TOP-DOWN${overviewFps > 0 ? ` · ${overviewFps.toFixed(1)} FPS` : ''}`
                : overviewRosImg
                  ? '● LIVE ROS STREAM'
                  : '● NO SIGNAL'}
            </span>
          </div>

          <div className="camera-screen">
            {overviewLive || overviewRosImg ? (
              <img
                src={overviewLive ? `${videoBaseUrl}/stream/overview` : (overviewRosImg ?? '')}
                alt="Arena Overhead Top-Down Camera"
                className="camera-stream-img"
              />
            ) : (
              <div className="camera-placeholder">
                <span className="camera-icon">◈</span>
                <h3>ARENA TOP-DOWN FEED</h3>
                <p>Waiting for /overview_camera/image from Gazebo VRX</p>
                <small>Bird&apos;s-eye view of Spot 1, FTP Gates, Buoys, WAM-V &amp; Spot 2</small>
              </div>
            )}
            <span className="camera-overlay">OVERHEAD CAM · 1280×720 TOP VIEW</span>
          </div>
        </section>

        <section className="camera-card map-card" id="map">
          <div className="card-heading">
            <div>
              <p className="section-label">
                NAVIGATION MONITORING · {isVrxCoords ? 'VRX 3D ARENA (120m × 60m)' : '2D MOCK ARENA (24m × 12m)'}
              </p>
              <h3>Mission Map</h3>
            </div>
            <span className={`feed-status ${connected && position.x !== null ? 'live' : ''}`}>
              {connected && position.x !== null ? '● LIVE TRACKING' : '● WAITING'}
            </span>
          </div>

          <div className="map-screen">
            <svg viewBox="0 0 760 300" className="mission-map">
              <defs>
                <pattern
                  id="mapGrid"
                  width="30"
                  height="30"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M 30 0 L 0 0 0 30"
                    fill="none"
                    stroke="#29445a"
                    strokeWidth="0.7"
                  />
                </pattern>
              </defs>

              <rect width="760" height="300" fill="url(#mapGrid)" />

              <rect
                x="40"
                y="25"
                width="680"
                height="250"
                fill="none"
                stroke="#355873"
                strokeWidth="1.5"
                strokeDasharray="6 4"
              />

              <rect
                x={spot1Svg.x - 20}
                y={spot1Svg.y - 22}
                width="40"
                height="44"
                rx="4"
                fill="#1d4f7a"
                opacity="0.45"
                stroke="#46c6dc"
                strokeWidth="1.2"
              />
              <text
                x={spot1Svg.x}
                y={spot1Svg.y - 30}
                textAnchor="middle"
                fill="#dcebf5"
                fontSize="12"
                fontWeight="700"
              >
                SPOT 1
              </text>

              <rect
                x={spot2Svg.x - 20}
                y={spot2Svg.y - 22}
                width="40"
                height="44"
                rx="4"
                fill="#1d4f7a"
                opacity="0.45"
                stroke="#e7b65e"
                strokeWidth="1.2"
              />
              <text
                x={spot2Svg.x}
                y={spot2Svg.y - 30}
                textAnchor="middle"
                fill="#e7b65e"
                fontSize="12"
                fontWeight="700"
              >
                SPOT 2
              </text>

              {displayBuoys.map((b) => {
                const pt = toSvg(b.x, b.y)
                return (
                  <circle
                    key={`buoy-${b.id}`}
                    cx={pt.x}
                    cy={pt.y}
                    r="6"
                    fill={b.color}
                    stroke="#dcebf5"
                    strokeWidth="1"
                  />
                )
              })}

              {plannedPoints.length > 1 && (
                <polyline
                  points={plannedPoints
                    .map((pt) => {
                      const s = toSvg(pt.x, pt.y)
                      return `${s.x},${s.y}`
                    })
                    .join(' ')}
                  fill="none"
                  stroke="#e7b65e"
                  strokeWidth="2"
                  strokeDasharray="5 5"
                  opacity="0.85"
                />
              )}

              {routePoints.length > 1 && (
                <polyline
                  points={routePoints
                    .map((pt) => {
                      const s = toSvg(pt.x, pt.y)
                      return `${s.x},${s.y}`
                    })
                    .join(' ')}
                  fill="none"
                  stroke="#46c6dc"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {vesselSvg && (
                <g
                  transform={`translate(${vesselSvg.x}, ${vesselSvg.y}) rotate(${
                    -(position.yawDeg ?? 0)
                  })`}
                >
                  <circle r="18" fill="#46c6dc" opacity="0.16" />
                  <polygon
                    points="14,0 -9,-8 -5,0 -9,8"
                    fill="#46c6dc"
                    stroke="#ffffff"
                    strokeWidth="2"
                  />
                </g>
              )}
              {vesselSvg && (
                <text
                  x={vesselSvg.x}
                  y={vesselSvg.y - 22}
                  textAnchor="middle"
                  fill="#46c6dc"
                  fontSize="11"
                  fontWeight="bold"
                >
                  NALA 16
                </text>
              )}
            </svg>
          </div>

          <div className="map-legend">
            <span>🔵 NALA 16 Vessel</span>
            <span>🟢🔴 FTP Gate Buoys</span>
            <span>🟡⚫ Obstacle Buoys</span>
            <span>┄ Planned A* Route</span>
            <span>〰 Actual Trail</span>
          </div>
        </section>

        <section className="section-block" id="telemetry">
          <div className="section-title">
            <div>
              <p className="section-label">VESSEL MONITORING</p>
              <h3>Live Telemetry</h3>
            </div>
          </div>

          <div className="stats-grid">
            <article className="stat-card">
              <span className="stat-icon">⌁</span>
              <p>Battery</p>
              <h2>
                {battery !== null ? battery : '--'}
                <small>%</small>
              </h2>
              <span className="stat-note">
                {voltage !== null
                  ? `${voltage.toFixed(1)} V · ROS 2 BatteryState`
                  : 'ROS 2 BatteryState'}
              </span>
            </article>

            <article className="stat-card">
              <span className="stat-icon">⌖</span>
              <p>Vessel Position</p>
              <h2>
                {position.x !== null && position.y !== null
                  ? `${position.x.toFixed(2)}, ${position.y.toFixed(2)}`
                  : '--, --'}
              </h2>
              <span className="stat-note">
                {position.speed !== null && position.yawDeg !== null
                  ? `v=${position.speed.toFixed(2)} m/s · yaw=${position.yawDeg.toFixed(0)}° · map frame`
                  : 'X / Y coordinates · map frame'}
              </span>
            </article>

            <article className="stat-card">
              <span className="stat-icon">◇</span>
              <p>Current Spot</p>
              <h2>{spot ?? '--'}</h2>
              <span className="stat-note">Based on vessel coordinates</span>
            </article>

            <article className="stat-card">
              <span className="stat-icon">▤</span>
              <p>Cargo Onboard</p>
              <h2>
                {cargo ?? '--'} <small>items</small>
              </h2>
              <span className="stat-note">
                {placedCargo !== null && totalCargo !== null
                  ? `${placedCargo}/${totalCargo} items delivered to Spot 2`
                  : 'Waiting for cargo data'}
              </span>
            </article>

            <article className="stat-card">
              <span className="stat-icon">⚠</span>
              <p>Collision Count</p>
              <h2>{collisions ?? '--'}</h2>
              <span className="stat-note">
                {collisions !== null
                  ? 'Total arena collisions'
                  : 'Waiting for collision data'}
              </span>
            </article>

            <article className="stat-card">
              <span className="stat-icon">◉</span>
              <p>Kill Switch Status</p>
              <h2 className="warning-text">{killSwitch}</h2>
              <span className="stat-note">
                {killSwitch === 'ACTIVE'
                  ? 'Emergency stop activated in simulation'
                  : 'No emergency stop signal detected'}
              </span>

              <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={handleKillSwitch}
                  disabled={!connected || killSwitch === 'ACTIVE'}
                  style={{
                    padding: '9px 14px',
                    background: '#c0392b',
                    color: 'white',
                    border: 'none',
                    borderRadius: '5px',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor:
                      connected && killSwitch !== 'ACTIVE'
                        ? 'pointer'
                        : 'not-allowed',
                    opacity: connected && killSwitch !== 'ACTIVE' ? 1 : 0.55,
                  }}
                >
                  ACTIVATE E-STOP
                </button>
                {killSwitch === 'ACTIVE' && (
                  <button
                    type="button"
                    onClick={handleResetEstop}
                    disabled={!connected}
                    style={{
                      padding: '9px 14px',
                      background: '#0e7490',
                      color: 'white',
                      border: 'none',
                      borderRadius: '5px',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    RESET E-STOP
                  </button>
                )}
              </div>
            </article>
          </div>
        </section>

        <section className="activity-card" id="activity">
          <div className="card-heading">
            <div>
              <p className="section-label">MISSION HISTORY</p>
              <h3>Activity Log</h3>
            </div>
            <span className="muted">Live events</span>
          </div>

          <div className="empty-activity">
            {activity.length === 0 ? (
              <p className="muted">No mission events received yet.</p>
            ) : (
              activity.map((event, index) => (
                <p
                  key={`${index}-${event}`}
                  style={{
                    padding: '10px 5px',
                    borderBottom: '1px solid #203447',
                    color: '#a9bbcc',
                    fontSize: '12px',
                    margin: 0,
                  }}
                >
                  {event}
                </p>
              ))
            )}
          </div>
        </section>

        <section className="activity-card">
          <div className="card-heading">
            <div>
              <p className="section-label">MISSION PERFORMANCE</p>
              <h3>FTP Score</h3>
            </div>
          </div>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              color: '#a9bbcc',
              fontSize: '13px',
            }}
          >
            {ftpScore ?? 'Waiting for FTP score data'}
          </pre>
        </section>

        <footer>
          NALA 16 MISSION CONTROL · WEB DASHBOARD (VISION ML + CONTROL + RVIZ)
          <span>LIVE INTEGRATED VERSION</span>
        </footer>
      </main>

      {showBridgeModal && (
        <div
          className="bridge-modal-backdrop"
          onClick={() => setShowBridgeModal(false)}
        >
          <div className="bridge-modal" onClick={(e) => e.stopPropagation()}>
            <div className="bridge-modal-head">
              <div>
                <p className="section-label">ROS 2 SIMULATION BRIDGE</p>
                <h3>Connection Settings</h3>
              </div>
              <button
                type="button"
                className="bridge-close-btn"
                onClick={() => setShowBridgeModal(false)}
              >
                ✕
              </button>
            </div>

            <p className="muted" style={{ marginTop: 0, lineHeight: 1.5 }}>
              Default otomatis ke <code>ws://localhost:9090</code> dan{' '}
              <code>http://localhost:8081</code> saat dibuka di komputer simulasi.
              Jika membuka dari perangkat lain / internet, masukkan URL tunnel (
              <code>wss://...</code> &amp; <code>https://...</code>) atau IP LAN.
            </p>

            <label className="bridge-field">
              <span>Rosbridge WebSocket URL (Port 9090)</span>
              <input
                type="text"
                value={draftWsUrl}
                onChange={(e) => setDraftWsUrl(e.target.value)}
                placeholder="ws://localhost:9090"
              />
            </label>

            <label className="bridge-field">
              <span>OpenCV Video Stream Base URL (Port 8081)</span>
              <input
                type="text"
                value={draftVideoUrl}
                onChange={(e) => setDraftVideoUrl(e.target.value)}
                placeholder="http://localhost:8081"
              />
            </label>

            <div className="bridge-modal-actions">
              <button
                type="button"
                className="bridge-secondary-btn"
                onClick={resetBridgeConfig}
              >
                Reset Default
              </button>
              <button
                type="button"
                className="bridge-secondary-btn"
                onClick={() =>
                  applyBridgeConfig(
                    'ws://localhost:9090',
                    'http://localhost:8081'
                  )
                }
              >
                Use Localhost
              </button>
              <button
                type="button"
                className="bridge-primary-btn"
                onClick={() => applyBridgeConfig(draftWsUrl, draftVideoUrl)}
              >
                Save &amp; Reconnect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
