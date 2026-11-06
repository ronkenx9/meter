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
  EVIDENCE: automatic-evidence=v1; definition-sha256=726e055f9b9a13d31a9505aa568d6be14d687155c10253221889347b586dba93; exit=0; EXPECT=matched; output-sha256=9c8cf867db430af90f604734297371e582083b9a68b3b55be78f679bfaba2c06; output-bytes=38; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/meter; path=a97eeaa5ee85/23 entries

- [x] G3: scenario/kit12.json matches the numbers in the official Kit 12 brief (parsed from research/builder-guide.md, not copied)
  CHECK: node scripts/check-scenario.mjs
  EXPECT: SCENARIO_MATCHES_KIT12
  EVIDENCE: automatic-evidence=v1; definition-sha256=17bb307fe9191ba595e7d6eb30ea8258914f0dc96312d2754e29a2f11185641d; exit=0; EXPECT=matched; output-sha256=45160c2b5421e2436354936184c1b6d7e8d83f83683eddd36823a4b38ea0113c; output-bytes=72; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/meter; path=a97eeaa5ee85/23 entries

- [x] G4: .env is git-ignored and no tracked or untracked-unignored file holds a credential-shaped value
  CHECK: node scripts/check-secrets.mjs
  EXPECT: SECRETS_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=d5745ed02f7bde11630a9ef2d480f159583fb4976894d83abf957945bee078aa; exit=0; EXPECT=matched; output-sha256=a0b791d4014a70e5a11e7d2066fbee5d59b83152b7be959d79b07543efb8bf53; output-bytes=22; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/meter; path=a97eeaa5ee85/23 entries

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
  EXPECT: KIT12_LIVE_OK B charged $
  EVIDENCE: automatic-evidence=v1; definition-sha256=2bbe8ec01e7019328b09a391fb12fb23c079c89449155235e371b4f945fd9403; exit=0; EXPECT=matched; output-sha256=0c166e2cbb29dae12d0f8ee25f77b271310cf73b34ada8b1ff77eff29a9213e8; output-bytes=81; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/meter; path=a97eeaa5ee85/23 entries

- [x] G11: the recorded Kit 12 run was decided and written by real Claude and was a good run: every plan from the model, all three jobs finished in full, every model tier used, no paragraph describing itself, a customer-approved raise funded after approval, float balanced, reconciled
  CHECK: node scripts/check-claude-run.mjs research/live-kit12-run.jsonl
  EXPECT: CLAUDE_RUN_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=51fc19f3a0227d2a78f23cbc00c9c605c26586d057d6179bbf31b41935921d3a; exit=0; EXPECT=matched; output-sha256=8ec2eee6342e01feec800bd1ff353a738adeac943f8b9b94c99985dcadc66c48; output-bytes=67; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/meter; path=a97eeaa5ee85/23 entries

- [x] G12: a live provider took payment and lost its answer: the run booked it as a paid failure, bought the step again, delivered it, and charged exactly what the wallet paid
  CHECK: node scripts/check-drills.mjs lost-answer research/live-lost-answer-drill.jsonl
  EXPECT: LOST_ANSWER_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=9e619f4028040d21b0e23639d155d2db6c8aebf588cbd2f94bd8fd8700c085ff; exit=0; EXPECT=matched; output-sha256=95638b2fcaabaeb3ffb24cfdb16ec1c499c6b6d33e19c3b794c88bd6e7a9a46e; output-bytes=88; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/meter; path=a97eeaa5ee85/23 entries

- [x] G13: a live run killed mid-job was settled by recovery: the hold captured exactly what the wallet paid, and running recovery again changed nothing
  CHECK: node scripts/check-drills.mjs crash research/live-crash-recovery-drill.jsonl
  EXPECT: CRASH_RECOVERY_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=a65909756a035c65209201a8de5a4ff8d5ff4908ae9fe84bfb1dfd62d896bee9; exit=0; EXPECT=matched; output-sha256=48a62c906448b26045f2271fbae8106ac6dfae8b42b04df2a8453273f910eb85; output-bytes=80; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/meter; path=a97eeaa5ee85/23 entries
