**Capital FM Claim Check**

https://github.com/pauldevelopai/node-capitalfm-verifier/

This is your newsroom's misinformation-defence app. You paste a suspect claim into it — a Facebook post, a WhatsApp screenshot, something that's circulating before the August 2026 election — and it returns a structured verification report: confidence tier, which past examples it looks like, what you should check next, and a draft response you can adapt.

It runs on one laptop in your newsroom for now. You'll use it, the team will use it, you'll feed in real cases as you encounter them. As you find what works and what doesn't, the app gets adjusted — that's the whole point of running it locally first. When it's solid, we deploy it live on the web so everyone in the newsroom can hit it from any browser. The plan is roughly:

May–July 2026 — one laptop, you and one or two colleagues using it, building up the corpus of past examples, telling Paul at Develop AI what's working and what isn't.

August 2026 — election window. Daily use. You're now the experts on what the AI gets right and where it stumbles.

After August — the app generalises beyond the election, and we move it from your laptop to the web.

This guide gets it running on the first laptop. No prior coding experience is needed.

If you get stuck on any step, that's normal. Email Paul at Develop AI and tell him exactly which step you're on and what your screen looks like — he'll get you unstuck. He's already done this with one other newsroom.

**A quick map of what we're about to do**

We'll do six things. Each one is small. After each, the app gets a bit closer to running.

1) Install two free programs on your computer (Node.js and VS Code). These are the tools the app uses.

2) Sign up with an AI provider (Anthropic or OpenAI) so the app can ask AI questions. You'll add the key inside the app later.

3) Get a copy of the app onto your computer. We do this through GitHub.

4) Run the app for the first time and add your AI key on the welcome screen.

5) Add the first few past examples to the app's corpus.

6) Check your first suspect claim.

Ready? Let's go.

**Part 1 — Install Node.js (the engine that runs the app)**

Open your web browser (Chrome, Safari, Firefox, Edge — any).

In the address bar at the top, type: nodejs.org — then press Enter.

You'll see a page with two big green buttons. Click the one on the left, labelled "LTS" (it stands for "Long-Term Support" — the stable version everyone uses).

A file downloads. When it finishes, find it in your Downloads folder.

Double-click that file to open the installer. Click Continue / Next on every screen, accept the agreement, and click Install. You may need to type your computer password.

When it says "Installation Successful" or similar, click Close.

You won't see any new app icon. That's normal. Node.js works behind the scenes — we'll prove it's installed in a later step.

**Part 2 — Install VS Code (where you'll type commands)**

VS Code is a free app from Microsoft. It's what we'll use to look at the app's code and to type the few commands needed to start it.

In your browser, go to: code.visualstudio.com

Click the big blue Download button. The site will pick the right version for your computer.

Open the downloaded file and follow the installer. Accept the defaults.

When it's installed, open VS Code. You should see a welcome screen with "Get Started" written on it. Close that tab — we'll come back here in a moment.

**Part 3 — You'll add your AI key inside the app**

The verification feature in this app asks an AI to reason about the claim, compare it against your past examples, and write the report. The app works with either Claude (from Anthropic) or GPT (from OpenAI) — you only need an account with one of them.

You'll add your key inside the app itself in Part 5, through a simple form. Nothing to do at this stage — just have an account ready. If you don't have either yet, pick one and sign up now:

Anthropic (Claude): go to console.anthropic.com, click Sign up, use your work email. Once signed in, click API Keys in the left sidebar, click Create Key, copy the key (starts with sk-ant-), paste it somewhere safe. Then click your name top-right → Billing and add £5 or $5 of credit. That covers a lot of verification.

OpenAI (GPT): go to platform.openai.com/api-keys, sign up, click Create new secret key, copy the key (starts with sk-), paste it somewhere safe. Then go to Settings → Billing and add £5 or $5 of credit.

Keep your key private — don't email it, don't share it, don't put it in a public document. In Part 5 the app will save it in a file on your own computer that never gets uploaded to GitHub.

**Part 4 — Get the app onto your computer**

This is the GitHub bit. GitHub is a website where the code for this app lives. You'll make your own personal copy of it on GitHub (called a fork), and then download that copy onto your computer. Your copy is yours forever — even if Develop AI disappears tomorrow, your copy keeps working.

Step 4a — Make a GitHub account (if you don't have one)

Go to: github.com

Click Sign up and follow the steps. Use your work email.

Step 4b — Fork the app to your own account

Once signed in to GitHub, go to: https://github.com/pauldevelopai/node-capitalfm-verifier

In the top-right of that page, click the button labelled Fork.

On the next screen, click the green Create fork button. (You can leave all the settings as they are.)

After a moment, GitHub shows you a copy of the project — but this time under your username. Look at the top-left to confirm: it should say your-username / node-capitalfm-verifier.

You now own a copy. Keep this browser tab open — we'll need it.

Step 4c — Add Paul as a collaborator on your fork

This is important. Develop AI improves the app as you give feedback. To do that, Paul needs permission to push small fixes to your copy. This is one click.

On your fork's page (the one that says your-username / node-capitalfm-verifier at the top), click Settings (it's near the right side of the menu under the repo name).

In the left sidebar, click Collaborators.

You may be asked to enter your GitHub password to continue. Do so.

Click the green Add people button.

Type: pauldevelopai

Click the result. Click Add pauldevelopai to this repository. (Set permission to "Write" if asked.)

That's it. Paul will get an email and accept the invitation. After that he can push improvements directly without you needing to do anything.

Step 4d — Download your copy to your computer

On your fork's page, find the green Code button (above the file list). Click it.

In the menu that drops down, click Download ZIP.

The ZIP file lands in your Downloads folder.

Unzip it (double-click on Mac; right-click → Extract All on Windows). You'll get a folder called something like node-capitalfm-verifier-main.

Move that folder somewhere sensible. Drag it into your Documents folder. Rename it if you want — Capital FM Claim Check is fine.

Step 4e — Open the folder in VS Code

Open VS Code (the app you installed in Part 2).

In the top menu, click File → Open Folder…

Choose the folder you just moved (Capital FM Claim Check or whatever you called it). Click Open / Select Folder.

VS Code may ask "Do you trust the authors of the files in this folder?" Click Yes, I trust the authors.

On the left side of VS Code you should now see a list of file names and folders: data, lib, public, index.js, package.json, and so on. That's the app.

**Part 5 — Run the app for the first time**

We're nearly there. Two commands to type, then the app opens.

Step 5a — Open VS Code's terminal

In VS Code, in the top menu, click View → Terminal.

A new panel opens at the bottom of VS Code with a white prompt. This is the terminal — where we type commands.

You should see something like your-name@computer Capital FM Claim Check % or PS C:\Users\your-name\Documents\Capital FM Claim Check> at the prompt. The important thing: the prompt should mention your folder name.

Step 5b — Install the app's parts

Click in the terminal so it's focused. Type exactly this and press Enter:

npm install

Lots of text scrolls by. This takes 30–60 seconds. It's downloading the pieces the app needs.

When it finishes, you'll see a fresh prompt (the line waiting for your next command). No big "Success!" message — silence means success.

If you see an error that says command not found: npm, Node.js didn't install correctly. Quit VS Code, restart your computer, and try Step 5b again from a fresh VS Code window. If still broken, go back to Part 1.

Step 5c — Start the app

In the same terminal, type:

npm start

After a moment, you'll see:

✓ Capital FM Claim Check is running.

✓ Open this in your web browser:  http://localhost:3000

  Press Ctrl+C in this window to stop it.

Leave this terminal window open. As long as it says "is running", the app is alive. If you close it, the app stops.

**Part 6 — Open the app, add your key**

Open your web browser. In the address bar, type: localhost:3000 then press Enter.

The very first time you open the app, you'll see a welcome screen asking which AI provider you want to use.

Click Anthropic or OpenAI (whichever you signed up with in Part 3), paste your API key into the box, and click Save and continue. The app stores your key on your own computer — it never gets uploaded to GitHub.

You'll now see the main dashboard with four tabs: Check a claim, Past examples, History, Activity.

**Part 7 — Add the first few past examples**

Before you check your first real claim, give the AI some context. Click the Past examples tab.

You'll see one template file already there — that's just a placeholder showing you the format. Use the form at the bottom of the page to add two or three real cases your newsroom remembers from past Zambian elections or recent months.

A good example file:

  • Has a short title at the top
  • Says what the claim was
  • Says where it appeared (Facebook, WhatsApp, radio)
  • Explains how it was debunked or what gave it away
  • Notes any phrases or patterns that recurred

Filename convention: YYYY-MM-DD-short-slug.txt

For example: 2024-03-04-lawmaker-resignation-rumour.txt

The more examples you add, the better the AI gets. Aim for at least ten before the August window. Twenty is better.

Once you've added a couple, delete the placeholder template file by removing it from the data/raw/training-examples folder in VS Code (right-click the file, Delete).

**Part 8 — Check your first suspect claim**

Click the Check a claim tab.

Paste a suspect claim into the text box. (For your first test, use something you already know is false — a piece of misinformation you remember from past months. That way you can see whether the AI catches it.)

If you have a screenshot of the claim (a Facebook post, a WhatsApp message), click Choose file and upload it. The AI will read the screenshot.

Optionally paste the source URL.

Click Check this claim.

After 15–30 seconds, the report appears: confidence tier (verified, contested, likely false, insufficient evidence), the matching past examples it found, its reasoning chain, the further checks you should run, and — if useful — a draft response you can adapt.

That report is now saved to your History tab so you can refer back to it.

**Using the app after the first day**

You don't have to repeat the setup. From now on:

On a Mac: double-click Start.command in your Capital FM Claim Check folder. (The first time, your Mac may say "cannot verify the developer". Right-click the file → Open → click Open in the dialog. After that, double-clicking works normally.)

On Windows: double-click Start.bat in your Capital FM Claim Check folder.

The terminal window opens, the server starts, and your browser opens automatically to the dashboard.

To stop the app: close the terminal window (or press Ctrl+C in it).

**The plan from here**

What we're doing for the first few weeks: you use it on one laptop. You add real cases to the corpus. You check claims as they come up. When the AI gets something wrong — wrong tier, missed a pattern, suggested the wrong check — you tell Paul. He adjusts the prompt, the corpus structure, the report shape, whatever's needed. Each adjustment ships as an update you'll pull down with the Update button (see below).

Closer to August, once we trust what it's doing, we'll deploy a live version on the web that any Capital FM journalist can use from any browser without installing anything. The laptop version stays around — it's still useful for confidential cases that shouldn't leave the building — but the day-to-day desk-side use moves to the hosted version.

**Getting updates from Develop AI**

Develop AI will improve the app over time. Getting the latest version is one double-click:

On a Mac: double-click Update.command in your Capital FM Claim Check folder.

On Windows: double-click Update.bat.

A terminal window opens, downloads the latest version, and applies it. Your corpus, your verification history, your settings, and any changes you've made are preserved automatically. When it says "Update complete", close the window and double-click Start again.

The first time you run Update, your computer may say it needs a tool called git. The Update window tells you exactly what to do:

Mac: you'll be prompted to install Apple's Command Line Tools. Click Install on the pop-up. It takes about 5 minutes. Then double-click Update.command again.

Windows: open the link the window gives you, download the Git installer, click Next on every screen, restart, then double-click Update.bat again.

This is a one-time install. After that, updates are always one double-click.

If the Update window ever says it couldn't apply the update automatically (because you edited a file that the new version also changed), it'll tell you to email Paul. Send him a screenshot of the window; he'll help. Nothing is lost — your edits are still where you left them.

**When something goes wrong**

"command not found: npm" or "node"

Node.js isn't installed correctly. Quit VS Code, restart your computer, and re-do Part 1.

"EADDRINUSE: address already in use :::3000"

The app is already running in another terminal window. Close that other terminal first.

The welcome screen won't accept my key

Make sure you copied the whole key — it's a long string. For Anthropic it starts with sk-ant-; for OpenAI it starts with sk-. If you're sure the key is right, your provider account may need credit added in its Billing section.

Browser shows "This site can't be reached"

The app isn't running. Look at the terminal — does it still say "is running"? If not, run npm start again.

The verification report says something obviously wrong

Tell Paul. This is exactly the feedback the prototype phase is for. Send him: the claim you checked, the report it produced, what you think the right answer was. The AI prompt and the corpus get adjusted based on these reports.

Update.command / Update.bat says "couldn't apply the update"

You edited a file that Paul also changed in the new version. Email Paul with a screenshot of the window; he'll help. Nothing is lost.

Something else

Email Paul with: (a) which step you're on, (b) what you tried to do, (c) the exact text of any error message. A screenshot helps.

If you ever want to use this app for confidential investigations (e.g. unpublished sources, sensitive material), talk to Paul first — the setup needs adjusting so that data doesn't leave your machine.

**Glossary**

Terminal — a window where you type commands instead of clicking. Don't be intimidated; it's just text in, text out.

npm — "Node Package Manager". The program that downloads the pieces this app needs. Comes with Node.js.

GitHub — a website that stores code and tracks changes to it.

Fork — your personal copy of someone else's GitHub project.

git — the tool the Update script uses to fetch the latest version. Comes free with Mac (via Apple's Command Line Tools) and Windows (via Git for Windows).

Corpus — the collection of past examples you've loaded into the app. The AI reads these before reasoning about any new claim.

Tier — the AI's confidence label for a claim: VERIFIED, CONTESTED, LIKELY FALSE, or INSUFFICIENT EVIDENCE. It's the AI's read; you decide what to publish.

Node (capital N, this app's kind) — a newsroom-owned app on GROUNDED. This whole project is a Node.

Node.js (with the .js) — the engine that runs the app. Different from a Node.

GROUNDED — the bigger AI infrastructure that Develop AI is building for African newsrooms. This Node lives inside GROUNDED's family of apps.

**Getting help**

Email Paul at Develop AI. Include:

What step you were on.

What you expected to happen.

What actually happened (paste any error messages exactly).

A screenshot if you can.

You're not bothering him by asking. Setup questions are normal. The point of the Nodes system is that newsrooms own their tools — and that means the first few hours of figuring it out is part of the job, for him too.
