# Narrator Voice Guide — Seb's Style

Reference for writing SLOPE demo narration scripts. The goal is to sound like Seb explaining something to a friend or a small audience, not a polished corporate voiceover.

## Tone

- **Conversational and warm.** Like you're walking someone through a screen share, not reading a teleprompter.
- **Enthusiastic but grounded.** Genuine excitement about what the tool does, never hype-y or salesy.
- **Thinking out loud.** It's ok to add asides, qualifications, and "the reason I say that is..." — that's how real explanations work.
- **Inclusive.** "Let me show you", "what you see here is", "we're going to" — bring the viewer along.

## Do's

- **Use natural transitions.** "All right, so let us take a look now", "Now what it's going to do is...", "You can see here..."
- **Explain the why, not just the what.** Don't just say what's happening on screen — say why it matters or why it works that way.
- **Add practical tips.** "What I like to do is...", "I really recommend...", "feel free to ramble" — share your actual workflow.
- **Qualify and add nuance.** "Of course, that is dependent on the LLM you use", "they don't necessarily need to be there" — acknowledge edge cases naturally.
- **Loop back to add context.** It's fine to say something and then circle back with more detail. "It's going to pull out your priorities. Of course, that is dependent on..."
- **Use contractions.** "It's", "that's", "you'll", "don't", "we're" — always.
- **Reference the viewer directly.** "You can see", "you have the opportunity", "let me know what you think."
- **Mention Slope's philosophy when relevant.** Push back is encouraged, structure is the goal, agents should communicate well with you.
- **Tease follow-ups naturally.** "I'll go through that in a follow-up video" — don't try to cover everything.

## Don'ts

- **Don't use marketing language.** No "powerful AI-driven solution", no "seamlessly integrates", no "revolutionizes your workflow."
- **Don't be terse or punchy.** Avoid short clipped sentences that sound like ad copy. "Vision locked. Watch what happens next." is too dramatic.
- **Don't narrate the UI literally.** Don't say "Now click the button" or describe every line appearing on screen. Describe what's happening conceptually.
- **Don't use jargon without context.** If you mention something technical, briefly explain it or why it matters.
- **Don't script exact timings.** Let sentences flow naturally rather than forcing them into rigid time windows.
- **Don't use "I" when referring to Slope.** Slope is "it" — you're showing the viewer what it does, not speaking as the tool.
- **Don't over-polish.** A slight ramble or aside is better than a perfectly constructed sentence that sounds scripted. Humans don't talk in topic sentences.
- **Don't assume expertise.** Explain things like "adjunct to the agile framework" or "sprints" briefly for people who might not know.

## Sentence structure patterns (from Seb's narration)

These are recurring patterns that feel natural:

- **Setup + reveal:** "What you see here is that it's scanning the codebase. It's going through the stack, the structure, the test coverage..."
- **Explanation + reason:** "It really recommends dictating here, and the reason I say that is because..."
- **Observation + practical tip:** "You can see we've agreed with this, and so we're going to go ahead with it."
- **Feature + personal workflow:** "There's also the concept of metaphors... I find it helps me with communicating."
- **Acknowledgment + nuance:** "That's only if you have them in your codebase; they don't necessarily need to be there."

## Vocabulary preferences

| Use this | Not this |
|----------|----------|
| "take a look" | "analyze" / "examine" |
| "put together" | "generate" / "construct" |
| "break it down" | "decompose" |
| "push back" | "provide feedback" / "iterate" |
| "boot it up" | "launch" / "initialize" |
| "dive into" | "explore in depth" |
| "pull out" / "pull together" | "extract" / "synthesize" |
| "on a good track" | "aligned" / "on rails" |
| "the most important thing" | "the key takeaway" |
| "let me know what you think" | "we welcome your feedback" |

## Example: rewriting a scripted line

**Scripted:** "It structures everything into a vision document — purpose, audience, priorities, non-goals. All from one conversation."

**Seb's voice:** "It's going to try and put together your vision. Once it's done, you have the opportunity to review it and then go ahead and change it and push back."

The Seb version is longer, less precise, but sounds like a real person explaining what's about to happen.

## How to use this guide

When writing narrator segments for `NARRATOR_SEGMENTS` in `demo.ts`:
1. Write each segment as if you're talking to someone watching your screen
2. Read it out loud — if it sounds like you're reading, rewrite it
3. It's ok if segments are longer than the "efficient" version — natural speech takes more words
4. Each segment should flow from what's visible on screen, not from a predetermined outline
