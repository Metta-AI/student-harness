/** Illustrations describe the process, never an actual match or a measured outcome. */
export function LearningSketch({ kind }: { kind: "watch" | "question" | "try" | "compare" }) {
  return <svg viewBox="0 0 200 145" fill="none" aria-hidden="true" className={`learning-sketch sketch-${kind}`}>
    {kind === "watch" ? <>
      <path d="M25 34 145 17 177 98 55 120Z" fill="#e8edde" stroke="#a6b393" strokeWidth="1.4" />
      <path d="m40 48 106 48M51 34l26 74M86 28l28 73M121 23l28 73" stroke="#cad2bd" />
      <path d="m49 96 27-32 31 4 29-28" stroke="#7e996e" strokeWidth="2" strokeDasharray="4 5" />
      <circle cx="76" cy="64" r="7" fill="#7c986b" stroke="#f9faf0" strokeWidth="3" /><circle cx="107" cy="68" r="6" fill="#c59170" stroke="#fff7e8" strokeWidth="3" />
      <circle cx="104" cy="65" r="27" fill="#f6f8eb" fillOpacity=".5" stroke="#506b50" strokeWidth="2.5" /><path d="m124 86 24 24" stroke="#506b50" strokeWidth="5" strokeLinecap="round" />
      <path d="m156 21 3-9m8 14 7-5" stroke="#c29152" strokeWidth="2" strokeLinecap="round" />
    </> : kind === "question" ? <>
      <path d="M36 103V33q0-7 8-7h103q8 0 8 7v70Z" fill="#fffaf0" stroke="#b8b69e" strokeWidth="1.4" transform="rotate(-5 100 70)" />
      <path d="M71 117V91l35-22 34 22v26M106 69V45" stroke="#829977" strokeWidth="2" strokeLinecap="round" />
      <rect x="86" y="22" width="40" height="28" rx="8" fill="#e4ebd7" stroke="#99ae88" /><path d="M101 33c0-8 13-8 13-1 0 4-7 3-7 8m0 4v1" stroke="#668057" strokeWidth="2" strokeLinecap="round" />
      <circle cx="71" cy="111" r="12" fill="#e6eddb" stroke="#9caf8d" /><path d="m66 111 4 4 7-8" stroke="#799667" strokeWidth="2" />
      <circle cx="140" cy="111" r="12" fill="#f0e3cf" stroke="#c7a578" /><path d="m136 107 8 8m0-8-8 8" stroke="#b38a57" strokeWidth="2" />
    </> : kind === "try" ? <>
      <path d="M33 111h133" stroke="#c9c7b1" strokeWidth="1.4" />
      <path d="M53 28h32m-27 0v39l-18 31q-5 12 9 12h42q14 0 9-12L80 67V28" stroke="#83977a" strokeWidth="2" fill="#f0f3e6" strokeLinejoin="round" />
      <path d="m52 80-11 19q-3 10 8 10h42q10 0 6-10L85 80Z" fill="#b7c89c" /><circle cx="66" cy="93" r="4" fill="#f5f6dd" /><circle cx="79" cy="84" r="2" fill="#f5f6dd" />
      <path d="M123 45h28m-22 0v31l-13 25q-4 9 7 9h29q11 0 7-9l-13-25V45" stroke="#ba9778" strokeWidth="2" fill="#fbf2e4" /><path d="m124 86-8 16q-2 7 6 7h31q8 0 6-7l-8-16Z" fill="#dbc097" />
      <path d="m101 46 5 8 9-4m-14 4 13-15" stroke="#ad9a6a" strokeWidth="1.5" /><circle cx="67" cy="17" r="3" stroke="#99af88" /><circle cx="138" cy="32" r="2" stroke="#c7a578" />
    </> : <>
      <rect x="22" y="29" width="68" height="80" rx="6" fill="#fcf8ed" stroke="#c9bfa3" transform="rotate(-6 55 70)" />
      <rect x="111" y="23" width="68" height="80" rx="6" fill="#f0f4e5" stroke="#a9b794" transform="rotate(5 145 70)" />
      <path d="m34 83 14-16 13 9 14-24m46 28 14-22 15 10 13-24" stroke="#a1ab8c" strokeWidth="2" strokeLinecap="round" />
      <circle cx="49" cy="67" r="4" fill="#d8b489" /><circle cx="136" cy="59" r="4" fill="#92ad78" />
      <path d="M76 124q25 14 53-5m-1 9 2-10-10-1" stroke="#7e966a" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M97 53h10m-4-4 5 4-5 4" stroke="#b09972" strokeWidth="1.5" />
    </>}
  </svg>;
}

