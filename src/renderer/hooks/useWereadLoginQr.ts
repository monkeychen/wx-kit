// src/renderer/hooks/useWereadLoginQr.ts
// 订阅主进程推送的微信读书扫码事件：confirmUrl 自画二维码 + 「已扫待确认」状态。
// LoginGate（整页引导）与 Settings（重新登录）共用同一条事件流。
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { api } from '../api'

export function useWereadLoginQr() {
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [scanned, setScanned] = useState(false)

  useEffect(() => {
    const offQr = api.onWereadLoginQr(async ({ confirmUrl }) => {
      setQrDataUrl(await QRCode.toDataURL(confirmUrl, { width: 220, margin: 1 }))
      setScanned(false)
    })
    const offState = api.onWereadLoginState(({ state }) => {
      if (state === 'scanned') setScanned(true)
    })
    return () => { offQr(); offState() }
  }, [])

  return { qrDataUrl, scanned }
}
