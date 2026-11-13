# Unslop audit: METER site and app

Method: unslop by Damir Sokolovsky ([@heydamir](https://x.com/heydamir)), CC BY 4.0, from `~/brain/skills/unslop`. Screens checked at 1440×900 and 375×812.

## Verdict

**Medium.** The basic craft is mostly there:
- Spacing, a neutral palette, one accent and real data, with no emoji, gradient text or purple.

The problem is **volume and repetition**, plus a few template habits:
- The landing page is 9,530 px tall and tells the same run three times.
- The app gives a dozen panels equal weight.

## Signs found

### Landing (`apps/orchestrator/public/landing.html`)

1. **Stacked, centered hero.** The headline, paragraph and two buttons are centered, with a picture below them. This is the template default.
2. **Floating loop.** The cards bob on an endless animation (`.fan-float`) and tilt with the pointer.
3. **The same story three times.**
   - The walkthrough is 3,630 px.
   - The embedded app replay is 1,046 px.
   - The "When things go wrong" tabs are 980 px.
   - Each retells the 11 Nov run.
4. **Uppercase tracked labels.**
   - Every section eyebrow ("HOW A RUN WORKS", "PROOF", "WHO IT'S FOR", "TRY IT").
   - The card tags ("CUSTOMER A", "CHARGED").
5. **A colored wash.** The dark band has a blurred clay light behind the quote, and uses a second typeface (Instrument Serif) for one line.
6. **Equal cards side by side.** Three stats, three "who it's for" columns and three try-it cards, each the same shape.
7. **Glass header.** A floating pill nav with a background blur.
8. **Nothing leads in the walkthrough stage.** It packs five kinds of object at once: the float, three cards, three wallets, five providers and a ticker. The coins also carry a colored shadow.
9. **Three highlights instead of one.** Steel, black and clay all compete in the hero, so no single card leads.

### App (`apps/orchestrator/public/index.html`)

10. **Equal weight everywhere.** The progress bar, float bar, three job cards and five side panels all read at the same level. The one figure that matters, each job's spend against its hold, competes with everything else.
11. **Pills everywhere.** The mode badge, header buttons, drill buttons, progress steps and recording picker are all full pills.
12. **The accent is used for six different things:**
    - the floor line;
    - the live badge;
    - a slow provider;
    - refused proposals;
    - the raise card;
    - the current step.

### Docs (`apps/orchestrator/public/docs.html`)

13. **Uppercase tracked labels** in the sidebar groups and the eyebrow. Otherwise light; it reads well.

## Direction (proposed)

- **Product:** runs AI research jobs for customers on a card hold, pays each provider per step, and charges exactly what was spent.
- **Character:** exact, accountable, a little warm.
- **World:** a bar tab and a till receipt: paper tape, tabular figures, a card left on the counter.
- **Moments:**
  - **Landing:** one metal card resting on a receipt that prints the run line by line. Each payment is a line, the shock and the customer's yes are marked lines, and at the bottom are the total, "charged to card" and "released". This replaces the five-object stage.
  - **App:** each job is its own running tab, with one large figure against its hold and its payments as receipt lines below it.
- **Signature:** the receipt line: a label, a dotted leader and a tabular amount, like `paragraph 12 · basic ........ $0.01`. It is used in the walkthrough, the app's payment lists and the docs' proof table, and nowhere else.

## What would change (after your yes)

### Landing: 8 sections become 5
1. **Hero as a split.** The headline and two actions on the left; on the right, the card on its receipt, printing.
2. **How a run works:** the five steps, with the receipt printing step by step.
3. **When things go wrong:** kept, because it is the one part with new information.
4. **Proof and who it's for**, merged into one section.
5. **Try it**, as one row of commands and links instead of three equal cards.

The embedded app replay becomes a link to `/app`. The dark band goes, and its line moves into the proof section.

### Everywhere
- **Palette:** a warm paper ramp on the landing page and graphite on the app and docs. Clay stays the one accent, used for the primary action and the one figure that matters.
- **Type:** Inter Tight stays, plus one mono (Geist Mono) for receipt figures. Sentence-case labels, no uppercase tracking, no second display face.
- **Motion:** no floating loop. The receipt prints once per step, and figures tween.

### App
- **Hierarchy:** the three running tabs lead. The market, decisions, proof and drills panels become quieter and smaller.
- **Shapes and accent:** buttons get radius by size instead of pills, and the accent is cut back to the primary action and the current step.

### Kept as is
- Every feature, the replay, the drills, the proof checks, the docs content and all the numbers.

## Applied (2026-11-13)

The direction was approved and applied.

### Landing page: 8 sections became 5
- **Hero:** a split, with Customer B's real receipt and one metal card on the right. The receipt prints once on load. Its lines are B's actual run: $0.88 paid, charged and $0.02 released.
- **How a run works:** the five steps, with the run printing as receipt lines from `/api/recordings/kit12`. A running tab per customer and the float reserve sit on top.
- **When things go wrong:** the four cases, each set as a receipt.
- **Proof:** the checks as a receipt, with "who it's for" as plain rows.
- **Try it:** one row of links and commands.

Gone: the embedded app replay (now a link), the dark band and its blurred wash, the floating loop, the glass header, the coin shadows and every uppercase tracked label.

### Palette, type and motion
- **Palette:** warm paper neutrals on the landing page, graphite on the app and docs. Clay is kept for the primary charge figure and the action that needs the customer.
- **Type:** Inter Tight, plus Geist Mono for figures.
- **Motion:** lines print once, bars tween, and nothing loops.

### App
- **Running tabs:** payments are receipt lines with dotted leaders and mono figures.
- **Quieter chrome:**
  - buttons are 8 px radius instead of pills;
  - the progress bar is a flat ruled row;
  - the mode is plain text with a dot;
  - a slow provider shows in amber and a refusal in red, each meaning one thing.

### Docs
- Sentence-case labels, a solid header and Geist Mono for code.

### Checks
- All 18 gates pass (including `check:pages`), along with 108 tests.
- No sideways overflow at 375 px, and no console errors.
