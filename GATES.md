# Gates: METER day-0 scaffold (no keys needed)

OWNS: package.json, pnpm-workspace.yaml, tsconfig.json, vitest.config.ts, .gitignore, .env.example, packages/core/**, packages/policy/**, packages/metal/**, scenario/**, scripts/**, research/metal-supported.json, packages/airwallex/**, research/airwallex-probe.json, packages/ledger/**, apps/**, research/**

Scope: a typed pnpm monorepo with tested unit conversion, the Kit 12 scenario, pure money-rule policy, and verified access to Metal's public facilitator and SDK, ready for the Airwallex and Metal probes once keys exist.

- [x] G1: the workspace installs and typechecks with no errors
  CHECK: pnpm -s typecheck && node -e "console.log('TYPECHECK_OK')"
  EXPECT: TYPECHECK_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=43d8d4fe5ece09a4e28fe3bad5a12b654ef5ccc9bf4abff1c22e77cadbd9a0f5; exit=0; EXPECT=matched; output-sha256=1e39179a923e90f2c8bf1b714fc8411fb1bb2bf28e625b9c4c722f2d8f8240e4; output-bytes=46; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/meter; path=a97eeaa5ee85/23 entries

- [x] G2: every unit and policy test passes, and there are tests to pass
  CHECK: node scripts/gate-tests.mjs
  EXPECT: /TESTS_OK total=\d+ failed=0/
  EVIDENCE: automatic-evidence=v1; definition-sha256=726e055f9b9a13d31a9505aa568d6be14d687155c10253221889347b586dba93; exit=0; EXPECT=matched; output-sha256=6781f1c6929e4d2e198e15509eaac0d61a3b87fc7a4040dfa3f6cc714e2d7678; output-bytes=37; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/meter; path=a97eeaa5ee85/23 entries

- [x] G3: scenario/kit12.json matches the numbers in the official Kit 12 brief (parsed from research/builder-guide.md, not copied)
  CHECK: node scripts/check-scenario.mjs
  EXPECT: SCENARIO_MATCHES_KIT12
  EVIDENCE: automatic-evidence=v1; definition-sha256=17bb307fe9191ba595e7d6eb30ea8258914f0dc96312d2754e29a2f11185641d; exit=0; EXPECT=matched; output-sha256=45160c2b5421e2436354936184c1b6d7e8d83f83683eddd36823a4b38ea0113c; output-bytes=72; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/meter; path=a97eeaa5ee85/23 entries

- [x] G4: .env is git-ignored and no tracked or untracked-unignored file holds a credential-shaped value
  CHECK: node scripts/check-secrets.mjs
  EXPECT: SECRETS_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=d5745ed02f7bde11630a9ef2d480f159583fb4976894d83abf957945bee078aa; exit=0; EXPECT=matched; output-sha256=35626fcd199865043e59e8da54efac88214ca4e4fd2c383af7f2e361e22c811a; output-bytes=22; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/meter; path=a97eeaa5ee85/23 entries

- [x] G5: Metal's testnet facilitator is up and advertises a bajillion clearing deployment on eip155:63825
  CHECK: node scripts/probe-metal.mjs
  EXPECT: /METAL_FACILITATOR_OK settlement=0x[0-9a-fA-F]{40}/
  EVIDENCE: automatic-evidence=v1; definition-sha256=12aa343e228571e60ac7db684bb53ee162ac950e44c1c0007c1e25f76b3e730c; exit=0; EXPECT=matched; output-sha256=de43e6e6ae16d82d94a82d5737f20c7f7cc277c8a3f43b2de17d25b8494bdaf5; output-bytes=146; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/meter; path=a97eeaa5ee85/23 entries

- [x] G6: the pinned @metalntwx/metal-pay exports every function the Kit 12 flow needs
  CHECK: node scripts/check-sdk.mjs
  EXPECT: METAL_SDK_OK
  CWD: packages/metal
  EVIDENCE: automatic-evidence=v1; definition-sha256=2fc3249d0db71003db1c08d26e8a60fd089cc92c44af6153da28ee3b90a12a3f; exit=0; EXPECT=matched; output-sha256=c0fcddb628c455bcfb1de4d7e80c6983e1636a19f84ac91af9ecd6022f1f1bfd; output-bytes=91; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/meter/packages/metal; path=a97eeaa5ee85/23 entries

## Day 1: Airwallex card holds (live sandbox)

- [x] G7: a customer-approved pre-auth hold was raised, partially captured once, refused a second capture and an over-hold capture, and a second hold was cancelled, confirmed against live Airwallex state
  CHECK: node --env-file=.env packages/airwallex/scripts/check-probe.ts
  EXPECT: AIRWALLEX_HOLD_EVIDENCE_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=d3342f81f1a74d039f6dede4da40ba2900b55ba7766ab13756bd2a7494201011; exit=0; EXPECT=matched; output-sha256=6e58ae309a7abc3fe87ef20a068e085e38b6075b1525f98c8b3feac9b6c2de13; output-bytes=115; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/meter; path=a97eeaa5ee85/23 entries

## Day 2: Metal clearing and the money path (live testnet)

- [x] G8: a real clearing run on Metal testnet is recorded: wallet record 0.10 matches the facilitator's settlements, a live reprice was paid, and an over-cap offer moved nothing
  CHECK: node -e "const p=require('./research/metal-clearing-probe.json');const has=(s)=>p.log.some(l=>l.step.startsWith(s));const r=p.log.find(l=>l.step==='reconcile');if(p.failures!==0||!has('over-cap offer')||!has('repriced')||r.walletSpent!=='0.100000'||r.facilitatorSettled!==r.walletSpent)process.exit(1);console.log('METAL_CLEARING_EVIDENCE_OK '+p.settlement)"
  EXPECT: METAL_CLEARING_EVIDENCE_OK 0x
  EVIDENCE: automatic-evidence=v1; definition-sha256=6ab3cf84e7d4e6ec6ac1feb15f711794f23e987d7a75c033ae5ce8ad529231c0; exit=0; EXPECT=matched; output-sha256=73d13453bbdbbbb6f1ed11c27f325cca028543a18eca23d1eb3b706e88931f00; output-bytes=70; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/meter; path=a97eeaa5ee85/23 entries

- [x] G9: one job ran the whole money path live (customer hold, clearing payments, capture exactly equal to the sum of payments, reconciled) and its hash-chained log verifies
  CHECK: node scripts/check-live-evidence.mjs research/live-one-job.jsonl
  EXPECT: LIVE_RUN_EVIDENCE_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=a97e28c3add03a9ce287f062e43eb9b1293282aa1cf778f9b52044852ad06b87; exit=0; EXPECT=matched; output-sha256=637eaeac1db204700dda75e05498d8f2eb6414d297a898a1febe5bcb4f7d66d5; output-bytes=49; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/meter; path=a97eeaa5ee85/23 entries

- [x] G10: the full Kit 12 scenario ran live: three customer holds, the overrun and slowdown, a customer-approved raise spent past the original hold, each capture exactly equal to that job's payments, deposits never past the hold at any moment, reconciled, log intact
  CHECK: node scripts/check-live-evidence.mjs research/live-kit12-run.jsonl && node -e "const L=require('fs').readFileSync('research/live-kit12-run.jsonl','utf8').trim().split('\n').map(JSON.parse);const has=(t,j)=>L.some(e=>e.type===t&&(!j||e.job===j));const cap=L.find(e=>e.type==='hold.captured'&&e.job==='B');if(!has('shock.overrun','B')||!has('shock.slowdown')||!has('job.rerouted')||!has('hold.raised','B')||new Set(L.filter(e=>e.type==='hold.placed').map(e=>e.job)).size!==3||Number(cap.data.captured.slice(1))<=0.75)process.exit(1);console.log('KIT12_LIVE_OK B charged '+cap.data.captured)"
  EXPECT: KIT12_LIVE_OK B charged $0.7
  EVIDENCE: automatic-evidence=v1; definition-sha256=9740ae629aaa8caf81a577f9d929d766030e8b10f010f0efe2e69fe4ba7e73fa; exit=0; EXPECT=matched; output-sha256=ec8a7a3fb6091e28ca65b504914ec4570171d6b730d2a74c325780ad26a963b1; output-bytes=81; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/meter; path=a97eeaa5ee85/23 entries
