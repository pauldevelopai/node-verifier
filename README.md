**Capital FM Election Watch**

https://github.com/pauldevelopai/node-capitalfm-verifier/

This is your newsroom's misinformation-defence app, tuned for the August 2026 Zambian elections. It does two things, under one roof:

**Verify mode** — a journalist pastes a suspect claim (a Facebook post, a WhatsApp screenshot, something circulating) and the AI returns a structured verification report: confidence tier, which past examples it looks like, what to check next, a draft response.

**Listen mode** — senior staff only. Track the *origin* of suspect Facebook content — pages with foreign administrators, coordinated talking-point lifts, identity-history anomalies — rather than what posts say. Includes a watchlist, post-by-post origin analysis, a coordination check across multiple posts, and a weekly editorial brief.

It runs on one laptop in your newsroom for now. You'll use it, the team will use it, you'll feed in real cases as you encounter them. As you find what works and what doesn't, the app gets adjusted — that's the whole point of running it locally first. When it's solid, we deploy it live on the web so everyone in the newsroom can hit it from any browser.

This guide gets it running. No prior coding experience is needed.

If you get stuck on any step, that's normal. Email Paul at Develop AI and tell him exactly which step you're on and what your screen looks like — he'll get you unstuck.

**Part of GROUNDED**

This app is a *Node* — one of a small family of newsroom-owned tools built on the same shared scaffolding (called GROUNDED). You'll see a thin terracotta bar across the top of the app and a small footer at the bottom, both saying GROUNDED. That's the family signature: it's how you (and Paul) know your app is up to date with the latest shared improvements.

Being part of GROUNDED has one practical implication for you to know about upfront: a small amount of usage data (what actions ran, when, which version of the app, what errors hit if any) is committed to your GitHub fork as you work. Paul can see this through a dashboard, which is how he spots problems early and improves the app for everyone. **None of your claim text, post text, screenshots, or API keys are shared.** There's a section near the end of this guide called "What you share with Develop AI" that spells out exactly what does and doesn't leave your laptop.

**A quick map of what we're about to do**

We'll do nine things. Each one is small. After each, the app gets a bit closer to running.

1) Install two free programs on your computer (Node.js and VS Code). These are the tools the app uses.

2) Sign up with an AI provider (Anthropic or OpenAI) so the app can ask AI questions. You'll add the key inside the app later.

3) Get a copy of the app onto your computer. We do this through GitHub.

4) Run the app for the first time and add your AI key on the welcome screen.

5) Add the first few past examples to the app's corpus.

6) Check your first suspect claim (Verify mode).

7) Add the first pages to the watchlist (Listen mode — senior staff).

8) Analyse your first suspect post for origin signals (Listen mode — senior staff).

9) Know how to ask for help.

Ready? Let's go.

**Part 1 — Install Node.js (the engine that runs the app)**

Go to: https://nodejs.org

Click the big green LTS button. (LTS = Long-Term Support — the stable version.)

The download starts. When it finishes, double-click the file (it's called something like node-v20.x.x.pkg on Mac, or node-v20.x.x-x64.msi on Windows).

Click Next / Continue through the installer. Default settings are fine. When it asks for your password (Mac) or admin permission (Windows), give it that.

When it says "Installation complete", close the installer.

You don't need to do anything else with Node.js — the app uses it under the hood.

**Part 2 — Install VS Code (where you'll type commands)**

We use VS Code because it has a built-in terminal that's easier than the system one, and you can open the app's folder in it to look at things if you ever need to.

Go to: https://code.visualstudio.com

Click the big blue Download button — it auto-picks Mac or Windows.

When the download finishes, double-click to install. Default settings are fine.

When it's installed, open VS Code. You should see a welcome screen with "Get Started" written on it. Close that tab — we'll come back here in a moment.

**Part 3 — Sign up with an AI provider**

The app needs to ask an AI questions on your behalf. The AI doesn't live inside the app — the app calls out to either Anthropic (the company that makes Claude) or OpenAI (the company that makes ChatGPT/GPT-4). You pick one. Either works for verification.

You only need to do this once.

Anthropic (Claude): go to console.anthropic.com, click Sign up, use your work email. Once signed in, click API Keys in the left sidebar, click Create Key, copy the key (starts with `sk-ant-`), paste it somewhere safe. Then click your name top-right → Billing and add £5 or $5 of credit. That covers a lot of verification.

OpenAI (GPT): go to platform.openai.com/api-keys, sign up, click Create new secret key, copy the key (starts with `sk-`), paste it somewhere safe. Then go to Settings → Billing and add £5 or $5 of credit.

Keep your key private — don't email it, don't share it, don't put it in a public document. In Part 4 the app will save it in a file on your own computer that never gets uploaded to GitHub.

**Part 4 — Get the app onto your computer**

This is the GitHub bit. GitHub is a website where the code for this app lives. You'll make your own personal copy of it on GitHub (called a *fork*), and then download that copy onto your computer. Your copy is yours forever — even if Develop AI disappears tomorrow, your copy keeps working.

Step 4a — Make a GitHub account (if you don't have one)

Go to: github.com

Click Sign up and follow the steps. Use your work email.

Step 4b — Fork the app to your own account

Once signed in to GitHub, go to: https://github.com/pauldevelopai/node-capitalfm-verifier

In the top-right of that page, click the button labelled Fork.

On the next screen, click the green Create fork button. (You can leave all the settings as they are.)

After a moment, GitHub shows you a copy of the project — but this time under your username. Look at the top-left to confirm: it should say `your-username / node-capitalfm-verifier`.

You now own a copy. Keep this browser tab open — we'll need it.

Step 4c — Add Paul as a collaborator on your fork

This is important. Develop AI improves the app as you give feedback. To do that, Paul needs permission to push small fixes to your copy. This is one click.

On your fork's page (the one that says `your-username / node-capitalfm-verifier` at the top), click Settings (near the right side of the menu under the repo name).

In the left sidebar, click Collaborators.

You may be asked to enter your GitHub password to continue. Do so.

Click the green Add people button.

Type: `pauldevelopai`

Click the result. Click Add pauldevelopai to this repository. (Set permission to "Write" if asked.)

That's it. Paul will get an email and accept the invitation. After that he can push improvements directly without you needing to do anything.

Step 4d — Download your copy to your computer

On your fork's page, find the green Code button (above the file list). Click it.

In the menu that drops down, click Download ZIP.

The ZIP file lands in your Downloads folder.

Unzip it (double-click on Mac; right-click → Extract All on Windows). You'll get a folder called something like `node-capitalfm-verifier-main`.

Move that folder somewhere sensible. Drag it into your Documents folder. Rename it if you want — `Capital FM Election Watch` is fine.

Step 4e — Open the folder in VS Code

Open VS Code (the app you installed in Part 2).

In the top menu, click File → Open Folder…

Choose the folder you just moved. Click Open / Select Folder.

VS Code may ask "Do you trust the authors of the files in this folder?" Click Yes, I trust the authors.

On the left side of VS Code you should now see a list of file names and folders: `data`, `lib`, `public`, `index.js`, `package.json`, and so on. That's the app.

**Part 5 — Run the app for the first time**

We're nearly there. Two commands to type, then the app opens.

Step 5a — Open VS Code's terminal

In VS Code, in the top menu, click View → Terminal.

A new panel opens at the bottom of VS Code with a prompt. This is the terminal — where we type commands.

You should see something like `your-name@computer Capital FM Election Watch %` or `PS C:\Users\your-name\Documents\Capital FM Election Watch>` at the prompt. The important thing: the prompt should mention your folder name.

Step 5b — Install the app's dependencies

Type this exactly, then press Enter:

```
npm install
```

The terminal scrolls through a lot of text for 30–60 seconds. When it's done, you'll see something like `added 130 packages` and the prompt returns. That's good.

Step 5c — Start the app

Type:

```
npm start
```

After a moment, the terminal says something like:

```
✓ Capital FM Election Watch is running.
✓ Open this in your web browser:  http://localhost:3000
```

The app is running.

**Part 6 — Open the app, add your key**

In any web browser (Chrome, Safari, Edge), go to: http://localhost:3000

The very first time you open the app, you'll see a welcome screen asking which AI provider you want to use.

Click Anthropic or OpenAI (whichever you signed up with in Part 3), paste your API key into the box, and click Save and continue. The app stores your key on your own computer — it never gets uploaded to GitHub.

The page reloads into the main dashboard. Notice the terracotta GROUNDED bar across the top and the dark footer at the bottom — that's the family signature.

You're in. Pick Verify mode (selected by default) or Listen mode using the pills at the top of the page.

**Part 7 — Add the first few past examples (Verify mode)**

The corpus is the heart of Verify mode. Every time the AI checks a new claim, it reads the corpus first — past Zambian-election misinformation examples your newsroom has flagged before — and uses them as context.

You want at least 10 examples in the corpus before the August window. Twenty is better. Each example is a short plain-text file.

Step 7a — Open the Past examples tab

In the app, click the "Past examples" tab in Verify mode.

Step 7b — Add one example

Scroll down to the "Add a new example" form.

Filename: use the date and a short slug, like `2021-08-12-fake-polling-station.txt`.

Content: write a few sentences describing:
- What the claim was
- Where it appeared (Facebook, WhatsApp, radio, etc.)
- How it was debunked, or what gave it away
- Optional but helpful: any phrases or patterns that recurred ("BREAKING:", misspelled official names, a particular phone number)

Click Add to corpus.

Step 7c — Repeat for a handful more

The more examples you collect, the better the AI gets at recognising new cases. Aim for 5 in the first week.

**Part 8 — Check your first suspect claim (Verify mode)**

In the app, click "Check a claim" (the first tab in Verify mode).

Paste the claim text into the box. If you've got a screenshot (a Facebook post, a WhatsApp message), click "Choose file" and attach it — the AI will read text out of the image too. Optionally paste the source URL.

Click Check this claim.

After 15–30 seconds, a verification report appears below the form:

- **Tier**: VERIFIED · CONTESTED · LIKELY FALSE · INSUFFICIENT EVIDENCE — the AI's read.
- **Claim restated**: a neutral one-sentence restatement.
- **Matching past examples**: which corpus examples this claim looks like, and why.
- **Reasoning**: numbered steps showing how the AI got there.
- **Further checks**: specific things you should do next (call a named official, check a specific ECZ document, look at the metadata of the image).
- **Suggested draft response**: a short correction or audience-facing post the newsroom could adapt.

Read it. Decide if you agree. Run the further checks. The tier is the AI's read, not yours — you're the editor.

Click "History" to see every claim you've checked.

**Part 9 — Listen mode (senior staff only)**

> This part is for senior staff with editorial oversight. The Listen mode workflow makes assertions about *origin* of content — which page produced it, whether multiple pages look coordinated, whether posts read as foreign-manufactured. These are sensitive editorial calls. Don't open this to general journalists.

Listen mode tracks *where Facebook content comes from*, not what it says. The same political claim from a transparent Zambian newsroom and from a page administered in another country with a recent name change are two completely different editorial situations.

Listen mode is paste-driven by design. CrowdTangle is shut down, Meta Content Library is research-access-only, the Graph API needs app review. v1 is built to the constraint: you paste post text and Facebook Page Transparency data, the AI does the analysis.

There are five tabs in Listen mode.

Step 9a — Build the watchlist

In the app, click Listen mode (top pills), then Watchlist.

The watchlist is the list of Facebook pages you're monitoring through the election cycle. For each page, you collect Page Transparency data manually from Facebook (admin country, creation date, name history, ad-library activity) and paste it into the form.

To get a page's transparency data: on Facebook, go to the page, scroll to the "Page transparency" section (usually in the right sidebar or About tab), click See all. That shows admin country, creation date, past page names, and whether the page has run ads.

Fill in the form:
- **Page name**: as shown on Facebook
- **Page URL**: the page's Facebook URL
- **Admin country**: from the transparency panel (e.g. "Zambia", "Russia", "Türkiye", or "unknown" if Facebook doesn't show one)
- **Page creation date**: from the transparency panel
- **Name history**: any past names Facebook lists, one per line
- **Newsroom notes**: why this page is on the watchlist — what triggered your attention
- **Ad Library active**: tick if the page is currently running ads

Click Add to watchlist.

Step 9b — Analyse a post

When you see a suspect post on one of your watchlist pages (or a new page you'd want to add later), click "Analyse a post".

Paste the post text. Add the page URL (the page that posted it) and the post URL if you have it. In "What triggered the concern?" describe in your own words what made you suspicious — identical phrasing to another page, an English construction no Zambian outlet uses, an image that looks generated, whatever it was. The AI weighs your observation alongside the page transparency data.

Click Run origin analysis.

After 15–30 seconds, the **Origin Risk Profile** appears:

- **Confidence label**: LOW CONCERN · WORTH WATCHING · STRONG SIGNALS · HIGHLY COORDINATED
- **Flags**: categorised observations — transparency mismatch, linguistic tells, talking-point lift, timing pattern, identity history, platform artefact
- **Why-chain**: numbered reasoning starting from observable evidence, not the conclusion
- **Further checks**: specific actions for senior staff (check Meta Ad Library, look for the same image on Russian-state-media sites, etc.)
- **What NOT to publish**: things the newsroom must not assert based on this analysis alone
- **Editorial lead**: if it's worth a story, what's the angle

This is *descriptive analysis*, not a verdict. Don't publish "Page X is a Russian operation" because the AI said STRONG SIGNALS. The output is your evidence base for further reporting.

The post is saved automatically to the Library.

Step 9c — Library and comparison

Click Library to see every post you've analysed. Each row shows when it was analysed, the page, a snippet of the post, and the confidence label.

To check whether two or more posts look coordinated: tick the checkboxes on the posts you want to compare, then click "Compare selected posts →". The AI looks for text overlap, shared phrasing, timing patterns, structural templates — and reports a coordination verdict (INDEPENDENT · WEAK OVERLAP · LIKELY COORDINATED · NEARLY IDENTICAL) with the evidence behind it. It also reports *divergences* — observations that argue against coordination — to keep the analysis honest.

Step 9d — Weekly brief

Click Weekly brief. Set the period (default: 7 days back). Click Generate brief.

The AI reads everything you've analysed in that window and produces a short editorial brief:
- Headline observation
- Patterns observed across multiple posts
- Shifts from previous periods
- Pages of concern
- Story leads with what-to-do-next
- What NOT to publish yet
- Stats

Internal use only. The brief is your view of the week's information environment. Not for publication.

Past briefs are listed below — you can scroll back through them.

**Using the app after the first day**

You don't have to repeat the setup. From now on:

On a Mac: double-click `Start.command` in your Capital FM Election Watch folder. (The first time, your Mac may say "cannot verify the developer". Right-click the file → Open → click Open in the dialog. After that, double-clicking works normally.)

On Windows: double-click `Start.bat` in your Capital FM Election Watch folder.

The terminal window opens, the server starts, and your browser opens automatically to the dashboard. Verify mode is on by default; switch to Listen mode using the pills at the top.

To stop the app: close the terminal window (or press Ctrl+C in it).

**What you share with Develop AI**

Honest spec of what does and doesn't leave your laptop.

**Lives only on your laptop. Never uploaded anywhere:**
- Your API key (in the `.env` file, which is git-ignored)
- The text of every claim you've checked
- The text of every post you've analysed
- Screenshots and images you've attached
- The full verification reports and origin profiles the AI produces
- Newsroom notes you've written on watchlist pages
- The corpus files (these stay on your laptop unless you choose to commit them)

**Committed to your GitHub fork (visible to Paul through the cohort dashboard):**
- `data/processed/node_capitalfm_verifier_meta.json` — install ID, app version, your laptop's OS, how many times the app has booted, when it was last opened
- `data/processed/node_capitalfm_verifier_activity.json` — the operation type and timestamp of every action (e.g. "verify_claim_done", "listener_analyze_done") with small structured fields (confidence tier, processing duration) — but **not** the claim text, post text, or AI output
- `data/processed/node_capitalfm_verifier_errors.json` — structured records of any errors that hit, with sanitised context that drops any sensitive fields automatically

The activity log helps Paul see how the app is actually being used — which features hit, where people get stuck, where errors cluster. The cohort dashboard he runs from his laptop reads from every newsroom's fork and gives him an oversight view. He never has access to your editorial work — only to the operational signal.

If you ever work on a confidential investigation (unpublished sources, sensitive material) and would prefer no telemetry at all, talk to Paul. The activity logging can be disabled per-install.

**The plan from here**

What we're doing for the first few weeks: you use it on one laptop. Verify mode gets the most use — every suspect claim that crosses the newsroom's desk runs through it. Listen mode is for the senior person watching for foreign info ops in the run-up to August. When the AI gets something wrong — wrong tier, missed a pattern, suggested the wrong check, mis-read an origin signal — you tell Paul. He adjusts the prompt, the corpus structure, the report shape, whatever's needed. Each adjustment ships as an update you'll pull down with the Update button (see below).

Closer to August, once we trust what it's doing, we'll deploy a live version on the web that any Capital FM journalist can use from any browser without installing anything. The laptop version stays around — it's still useful for confidential cases that shouldn't leave the building — but the day-to-day desk-side use moves to the hosted version.

**Getting updates from Develop AI**

Develop AI will improve the app over time. Getting the latest version is one double-click:

On a Mac: double-click `Update.command` in your Capital FM Election Watch folder.

On Windows: double-click `Update.bat`.

A terminal window opens, downloads the latest version, and applies it. Your corpus, your verification history, your watchlist, your library, your settings, and any changes you've made are preserved automatically. When it says "Update complete", close the window and double-click Start again.

The first time you run Update, your computer may say it needs a tool called git. The Update window tells you exactly what to do:

Mac: you'll be prompted to install Apple's Command Line Tools. Click Install on the pop-up. It takes about 5 minutes. Then double-click `Update.command` again.

Windows: open the link the window gives you, download the Git installer, click Next on every screen, restart, then double-click `Update.bat` again.

This is a one-time install. After that, updates are always one double-click.

If the Update window ever says it couldn't apply the update automatically (because you edited a file that the new version also changed), it'll tell you to email Paul. Send him a screenshot of the window; he'll help. Nothing is lost — your edits are still where you left them.

**When something goes wrong**

`command not found: npm` or `node`

Node.js isn't installed correctly. Quit VS Code, restart your computer, and re-do Part 1.

`EADDRINUSE: address already in use :::3000`

The app is already running in another terminal window. Close that other terminal first.

The welcome screen won't accept my key

Make sure you copied the whole key — it's a long string. For Anthropic it starts with `sk-ant-`; for OpenAI it starts with `sk-`. If you're sure the key is right, your provider account may need credit added in its Billing section.

Browser shows "This site can't be reached"

The app isn't running. Look at the terminal — does it still say "is running"? If not, run `npm start` again.

I want to change my API key

In the app, top-right of the header, click the "change API key" link. Confirm, and the welcome screen comes back so you can paste a new key. Your data is kept.

The verification report says something obviously wrong

Tell Paul. This is exactly the feedback the prototype phase is for. Send him: the claim you checked, the report it produced, what you think the right answer was. The AI prompt and the corpus get adjusted based on these reports.

The origin profile says HIGHLY COORDINATED but I don't trust it

Same — tell Paul. Listen mode is newer and the prompts will need iterating against real Zambian-election cases. Send him the post text, the page transparency data, the profile, and your own read. Don't publish anything based on it until you've verified independently.

I want to remove a page from the watchlist or a post from the library

In the watchlist or library tab, each item has a Remove button.

`Update.command` / `Update.bat` says "couldn't apply the update"

You edited a file that Paul also changed in the new version. Email Paul with a screenshot of the window; he'll help. Nothing is lost.

Something else

Email Paul with: (a) which step you're on, (b) what you tried to do, (c) the exact text of any error message. A screenshot helps.

**Glossary**

Terminal — a window where you type commands instead of clicking. Don't be intimidated; it's just text in, text out.

npm — "Node Package Manager". The program that downloads the pieces this app needs. Comes with Node.js.

GitHub — a website that stores code and tracks changes to it.

Fork — your personal copy of someone else's GitHub project.

git — the tool the Update script uses to fetch the latest version. Comes free with Mac (via Apple's Command Line Tools) and Windows (via Git for Windows).

Corpus — the collection of past misinformation examples you've loaded into Verify mode. The AI reads these before reasoning about any new claim.

Tier — the AI's confidence label for a claim in Verify mode: VERIFIED, CONTESTED, LIKELY FALSE, or INSUFFICIENT EVIDENCE. It's the AI's read; you decide what to publish.

Watchlist — in Listen mode, the list of Facebook pages you're monitoring, each with Page Transparency data you've collected manually.

Origin Risk Profile — the structured output of Listen mode's post analysis. Descriptive flags + reasoning chain + suggested further checks. Not a verdict.

Coordination verdict — what the Compare workflow returns when you check two or more posts against each other: INDEPENDENT, WEAK OVERLAP, LIKELY COORDINATED, or NEARLY IDENTICAL.

Node (capital N, this app's kind) — a newsroom-owned app on GROUNDED. This whole project is a Node.

Node.js (with the .js) — the engine that runs the app. Different from a Node.

GROUNDED — the bigger AI infrastructure that Develop AI is building for African newsrooms. This Node lives inside GROUNDED's family of apps. You'll see the terracotta GROUNDED bar at the top of the app.

**Getting help**

Email Paul at Develop AI. Include:

- What step you were on.
- What you expected to happen.
- What actually happened (paste any error messages exactly).
- A screenshot if you can.

You're not bothering him by asking. Setup questions are normal. The point of the Nodes system is that newsrooms own their tools — and that means the first few hours of figuring it out is part of the job, for him too.
