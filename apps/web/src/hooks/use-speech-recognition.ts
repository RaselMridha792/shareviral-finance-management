"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/* -------------------------------------------------------------------------- */
/*  The Web Speech API, declared only as far as this needs it                  */
/* -------------------------------------------------------------------------- */

/**
 * TypeScript's DOM library does not ship these, and the two packages that do
 * are a dependency for something the browser already implements. Everything
 * below is the slice of the spec this hook actually touches — named `…Like` so
 * it can never collide with a global the DOM lib adds later.
 */
type SpeechAlternativeLike = {
  readonly transcript: string;
  readonly confidence: number;
};

type SpeechResultLike = {
  readonly length: number;
  readonly isFinal: boolean;
  readonly [index: number]: SpeechAlternativeLike;
};

type SpeechResultListLike = {
  readonly length: number;
  readonly [index: number]: SpeechResultLike;
};

type SpeechResultEventLike = {
  readonly resultIndex: number;
  readonly results: SpeechResultListLike;
};

/** `error` is a short code — "no-speech", "not-allowed", "network", … */
type SpeechErrorEventLike = { readonly error: string };

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  /** Finishes the utterance: a final result may still arrive. */
  stop(): void;
  /** Throws the utterance away. */
  abort(): void;
  onstart: (() => void) | null;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: SpeechErrorEventLike) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

/** Chrome and Edge ship it prefixed; the unprefixed name is the standard one. */
function getRecogniser(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/* -------------------------------------------------------------------------- */
/*  Languages                                                                  */
/* -------------------------------------------------------------------------- */

export type SpeechLang = "bn-BD" | "en-US";

export const SPEECH_LANG_LABELS: Record<SpeechLang, string> = {
  "bn-BD": "Bangla",
  "en-US": "English",
};

/**
 * Two or three characters, because this sits in an already crowded row.
 *
 * People here mix both languages inside one sentence, and no engine handles
 * that — whichever is set wins the ambiguous words. Bangla is the default
 * because the sentence around the figure is usually Bangla even when the
 * figure and the account name are English.
 */
export const SPEECH_LANG_SHORT: Record<SpeechLang, string> = {
  "bn-BD": "বাং",
  "en-US": "EN",
};

/* -------------------------------------------------------------------------- */
/*  Failures, in words a person can act on                                     */
/* -------------------------------------------------------------------------- */

const UNKNOWN_FAILURE = "Could not listen just now — type it instead";

const FAILURES: Record<string, string> = {
  "no-speech": "Nothing heard",
  "audio-capture": "No microphone found",
  "not-allowed": "Microphone blocked — allow it in the address bar",
  "service-not-allowed": "Microphone blocked — allow it in the address bar",
  network: "The speech service could not be reached",
  "language-not-supported": "This browser cannot listen in that language",
  "bad-grammar": UNKNOWN_FAILURE,
};

/* -------------------------------------------------------------------------- */
/*  The hook                                                                   */
/* -------------------------------------------------------------------------- */

/** Whether the API exists never changes while the tab is open. */
const NOTHING_TO_SUBSCRIBE_TO = () => () => {};
const RECOGNISER_EXISTS = () => getRecogniser() !== null;
/** There is no microphone on a server, and pretending otherwise would render
 *  a button on the server that vanishes on hydration. */
const NOT_ON_THE_SERVER = () => false;

export type SpeechRecognitionHandle = {
  /** False on Safari, Firefox and several Android browsers. Do not render a
   *  microphone at all when this is false — a control that cannot work is
   *  worse than no control. */
  supported: boolean;
  listening: boolean;
  /** What is being heard right now, before the engine commits to it. */
  interim: string;
  /** A finished, plain sentence — never a thrown error. */
  error: string | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
  clearError: () => void;
};

/**
 * One press, one utterance, handed back as text.
 *
 * Nothing here talks to a server: recognition happens in the browser (Chrome
 * does send audio to Google's service, which is worth knowing, but this app
 * pays for and configures none of it). The caller decides what to do with the
 * sentence — this hook never touches an input on its own.
 */
export function useSpeechRecognition({
  lang,
  onTranscript,
}: {
  lang: SpeechLang;
  onTranscript: (text: string) => void;
}): SpeechRecognitionHandle {
  const supported = useSyncExternalStore(
    NOTHING_TO_SUBSCRIBE_TO,
    RECOGNISER_EXISTS,
    NOT_ON_THE_SERVER,
  );

  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const session = useRef<SpeechRecognitionLike | null>(null);
  const abandoned = useRef(false);

  // Kept in a ref so a new callback on every render does not mean tearing down
  // and rebuilding a live microphone session.
  const deliver = useRef(onTranscript);
  useEffect(() => {
    deliver.current = onTranscript;
  });

  const start = useCallback(() => {
    const Recogniser = getRecogniser();
    if (!Recogniser || session.current) return;

    let listener: SpeechRecognitionLike;
    try {
      listener = new Recogniser();
    } catch {
      setError(UNKNOWN_FAILURE);
      return;
    }

    listener.lang = lang;
    // One utterance per press. Continuous listening in a room with other
    // people in it records the room.
    listener.continuous = false;
    // Words appear as they are spoken, so a person can tell it is working
    // before they have finished the sentence.
    listener.interimResults = true;
    listener.maxAlternatives = 1;

    // This session's text lives in the closure, not in state: what `onend`
    // hands over must be what was actually heard, not whatever a render
    // happened to observe.
    let settled = "";
    let partial = "";

    listener.onstart = () => {
      setListening(true);
    };

    listener.onresult = (event) => {
      settled = "";
      partial = "";
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const spoken = result[0]?.transcript ?? "";
        if (result.isFinal) settled += spoken;
        else partial += spoken;
      }
      setInterim(`${settled} ${partial}`.trim());
    };

    listener.onerror = (event) => {
      // Stopping on purpose is reported as an error. It is not one.
      if (event.error === "aborted") return;
      setError(FAILURES[event.error] ?? UNKNOWN_FAILURE);
    };

    listener.onend = () => {
      session.current = null;
      setListening(false);
      setInterim("");
      if (abandoned.current) return;

      // Some engines end without ever marking a result final — usually when
      // the person pressed stop mid-sentence. Handing over the rougher text
      // beats losing the sentence; it is read back and edited either way.
      const heard = (settled || partial).trim();
      if (heard) deliver.current(heard);
    };

    abandoned.current = false;
    session.current = listener;
    setError(null);

    try {
      listener.start();
    } catch {
      // Already running, or the tab lost the microphone between the check and
      // the call.
      session.current = null;
      setError(UNKNOWN_FAILURE);
    }
  }, [lang]);

  const stop = useCallback(() => {
    try {
      session.current?.stop();
    } catch {
      // Already stopping. `onend` still fires.
    }
  }, []);

  /** Ends the session and throws away what it heard. */
  const cancel = useCallback(() => {
    const listener = session.current;
    if (!listener) return;
    abandoned.current = true;
    session.current = null;
    try {
      listener.abort();
    } catch {
      // Nothing left to abort.
    }
    setListening(false);
    setInterim("");
  }, []);

  const toggle = useCallback(() => {
    // The ref rather than `listening`, which only turns true once the engine
    // has actually opened the microphone — a second press before that should
    // still cancel rather than start a second session.
    if (session.current) stop();
    else start();
  }, [start, stop]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Leaving the page mid-sentence must not leave the microphone open. Passing
  // the callback itself, rather than an arrow that reaches into the ref, keeps
  // this out of the "ref will have changed by cleanup" trap.
  useEffect(() => cancel, [cancel]);

  return {
    supported,
    listening,
    interim,
    error,
    start,
    stop,
    toggle,
    clearError,
  };
}
