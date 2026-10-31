import { describe, expect, it } from 'vitest'
import { clickPayload, keyPayload, launchPayload, magicPacket, pointerPayload } from './samsung.ts'

describe('samsung', () => {
  it('builds the remote key and launch messages', () => {
    expect(JSON.parse(keyPayload('KEY_VOLUP'))).toEqual({
      method: 'ms.remote.control',
      params: { Cmd: 'Click', DataOfCmd: 'KEY_VOLUP', Option: 'false', TypeOfRemote: 'SendRemoteKey' },
    })
    expect(JSON.parse(launchPayload('111299001912')).params.data).toEqual({ appId: '111299001912', action_type: 'DEEP_LINK' })
  })

  it('builds the pointer move and click messages', () => {
    const move = JSON.parse(pointerPayload(12.4, -7.6))
    expect(move.method).toBe('ms.remote.control')
    expect(move.params).toMatchObject({ Cmd: 'Move', Position: { x: 12, y: -8 }, TypeOfRemote: 'ProcessMouseDevice' })
    expect(JSON.parse(clickPayload()).params).toEqual({ Cmd: 'LeftClick', TypeOfRemote: 'ProcessMouseDevice' })
  })

  it('builds the Wake-on-LAN packet', () => {
    const p = magicPacket('54:bd:79:9d:44:bb')
    expect(p.length).toBe(6 + 16 * 6)
    expect([...p.subarray(0, 6)]).toEqual([255, 255, 255, 255, 255, 255])
    expect(p.subarray(6, 12).toString('hex')).toBe('54bd799d44bb')
    expect(p.subarray(96, 102).toString('hex')).toBe('54bd799d44bb')
    expect(() => magicPacket('nope')).toThrow()
  })
})
