# Demo Film Script

1 minute 31 seconds, 1920x1080. Built with Remotion in `film/` from stills of the app during live run 3 on Nebius Token Factory (October 24, 2026). Narrated by the ElevenLabs voice Eric over an ElevenLabs Music bed, ending on an ElevenLabs Sound Effects chime. The lines below are the single source in `film/src/apprentice/script.ts`.

| Scene | On screen | Narration |
|---|---|---|
| Intro | Logo, "Apprentice", "Teach a small model one job" | This is Apprentice. An agent that teaches a small open model one job, and proves it learned. |
| The job | New Run: the task, the examples, the three models; the cursor presses Start | Give it a narrow job and some labelled examples. Here, routing tricky support tickets into eight queues. Then press start. |
| Baseline | The loop's stages, then the agent's feed | First, it tests NVIDIA Nemotron 3 Nano on a hundred and twenty tickets it never learns from. Seventy-four percent. Nemotron 3 Ultra takes the same test, and sets the bar at ninety. |
| Teach | The feed: failure types, cases written and kept | Next, Nemotron 3 Super sorts Nano's mistakes into failure types. Ultra writes new cases aimed at each one, and the grader labels every case blind. Only the cases they agree on are kept. |
| Playbook | The playbook in its glass window | Then Apprentice writes a playbook: house rules and worked examples, straight into Nano's instructions. Nothing to deploy. It runs per token on Nebius Token Factory. |
| Prove | The run finishes; the cursor opens the results; the dials read 87% taught, 74% base | Now, the same held-out test. Eighty-seven percent, up from seventy-four, and four tickets short of Ultra. It ships only because it won. |
| Receipts | Every Call; cost per 1,000 tickets; the Runs list with all three live runs | Every call comes with a receipt. The taught Nano answers a thousand tickets for under four cents, against twenty cents for Ultra. And every run is kept: across three live runs, it gained eleven, three and fifteen tickets. |
| The $1 challenge | $0.29 of $1.00, with the breakdown | Our challenge was to prove all of it on one dollar of credit. Three live runs, a LoRA fine-tune of Qwen3 4B, and every test: twenty-nine cents. |
| Outro | Logo; Test. Teach. Prove. Ship.; the models and platform | Apprentice. Test it, teach it, prove it, then ship it. |

Footer on the last frame: "Recorded live on Nebius Token Factory, October 24, 2026. Every run, including the weaker ones: docs/RESULTS.md."
