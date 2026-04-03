import { useState, useRef, useCallback, useEffect } from 'react'
import { edgeFetch } from '@/lib/api'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabase } from '@/lib/supabase'

type VoiceState = 'idle' | 'recording' | 'transcribing'

/**
 * Safari-compatible voice input.
 * 1) Tries Web Speech API (Chrome, Edge, iOS Safari)
 * 2) Falls back to MediaRecorder + Whisper (desktop Safari, Firefox)
 */
export function useVoiceInput(onTranscript: (text: string) => void) {
  const [state, setState] = useState<VoiceState>('idle')
  const recognitionRef = useRef<any>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const usingWebSpeech = useRef(false)

  const hasSpeechRecognition = typeof window !== 'undefined' &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)

  const stop = useCallback(() => {
    if (usingWebSpeech.current) {
      recognitionRef.current?.stop()
    } else {
      mediaRecorderRef.current?.stop()
    }
    setState('idle')
  }, [])

  const startWebSpeech = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const recognition = new SR()
    recognition.lang = 'ru-RU'
    recognition.continuous = false
    recognition.interimResults = false
    recognitionRef.current = recognition
    usingWebSpeech.current = true

    recognition.onresult = (e: any) => {
      let transcript = ''
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          transcript += e.results[i][0].transcript
        }
      }
      if (transcript.trim()) onTranscript(transcript.trim())
    }
    recognition.onerror = () => setState('idle')
    recognition.onend = () => setState('idle')
    recognition.start()
    setState('recording')
  }, [onTranscript])

  const startMediaRecorder = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      
      // Safari supports mp4/aac, Chrome supports webm/opus
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : 'audio/webm'
      
      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder
      usingWebSpeech.current = false

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        if (chunksRef.current.length === 0) { setState('idle'); return }

        setState('transcribing')
        try {
          const blob = new Blob(chunksRef.current, { type: mimeType })
          const ext = mimeType.includes('mp4') ? 'mp4' : 'webm'
          const formData = new FormData()
          formData.append('audio', blob, `recording.${ext}`)

          const res = await edgeFetch('speech-to-text', {
            method: 'POST',
            headers: {}, // edgeFetch adds auth, but we need to remove Content-Type for FormData
            body: formData,
          })

          // Need to refetch without Content-Type header for FormData
        } catch (err) {
          console.error('Transcription error:', err)
        }
        setState('idle')
      }

      recorder.start()
      setState('recording')
    } catch (err) {
      console.error('Microphone access error:', err)
      setState('idle')
    }
  }, [onTranscript])

  // Better approach: direct fetch for FormData (edgeFetch sets Content-Type: json)
  const startMediaRecorderDirect = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : 'audio/webm'
      
      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder
      usingWebSpeech.current = false

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        if (chunksRef.current.length === 0) { setState('idle'); return }

        setState('transcribing')
        try {
          const blob = new Blob(chunksRef.current, { type: mimeType })
          const ext = mimeType.includes('mp4') ? 'mp4' : 'webm'
          const formData = new FormData()
          formData.append('audio', blob, `recording.${ext}`)

          let { data: { session } } = await supabase.auth.getSession()
          if (!session?.access_token) throw new Error('Not authenticated')

          const res = await fetch(`${SUPABASE_URL}/functions/v1/speech-to-text`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              apikey: SUPABASE_PUBLISHABLE_KEY,
            },
            body: formData,
          })

          if (!res.ok) throw new Error('Transcription failed')
          const data = await res.json()
          if (data.text) onTranscript(data.text)
        } catch (err) {
          console.error('Transcription error:', err)
        }
        setState('idle')
      }

      recorder.start()
      setState('recording')
    } catch (err) {
      console.error('Microphone access error:', err)
      setState('idle')
    }
  }, [onTranscript])

  const toggle = useCallback(() => {
    if (state !== 'idle') {
      stop()
      return
    }
    if (hasSpeechRecognition) {
      startWebSpeech()
    } else {
      startMediaRecorderDirect()
    }
  }, [state, hasSpeechRecognition, stop, startWebSpeech, startMediaRecorderDirect])

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
      mediaRecorderRef.current?.stop()
    }
  }, [])

  return { state, toggle, isRecording: state === 'recording', isTranscribing: state === 'transcribing' }
}
