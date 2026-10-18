## 0:00–0:40 — Introduction

Hi, I'm [your name]. This is my submission for the FDE assignment.

I've built a small product called CallFlow. The idea came from the task itself: imagine someone making a cold call while keeping another screen open beside them.

When you're talking to someone, it's easy to forget what you wanted to ask, miss an important detail, or finish the call without recording what should happen next.

I wanted to build something simple that helps the caller stay on track without making the conversation feel too complicated.

I'll show you what I've built, why I made a few decisions, and what I would improve next.

## 0:40–1:30 — Starting a call

[Show the deployed CallFlow website.]

This is the main screen. I've tried to keep the interface simple because I don't think a tool like this needs too many things competing for your attention.

I'll start a call using one of the sample prospects.

[Select a prospect and click Start Call.]

The idea is that the caller can prepare the prospect information and then follow the conversation through eight stages.

I chose a guided workflow rather than putting everything on one screen. A cold call has a natural progression, from introducing yourself to understanding the other person's needs and agreeing on a next step.

Of course, real conversations don't always follow a fixed order. The stages are meant to help the caller, not force the prospect to follow a script.

## 1:30–2:30 — Demonstrating the stages

[Move through the actual stage screens.]

Here, the caller can see which stage they're on, what that stage is trying to achieve, and what the prospect might say.

The important part is that the caller can record the prospect's own words, especially when discussing their needs.

I think this matters because a salesperson's interpretation and the prospect's actual words aren't always the same thing.

For example, saying that someone is interested is not the same as knowing what problem they're trying to solve.

[Enter a short sample note and save it.]

The caller can also record the next action and the outcome when the conversation ends. This information becomes useful later, instead of disappearing when the call is over.

## 2:30–3:25 — Using previous calls and the transcript data

[Open Past Calls and inspect a completed call. Use one of the supplied transcripts, such as T001, if the implemented interface supports demonstrating it.]

The assignment included a hundred call transcripts, and I used them as a reference for thinking about how real conversations move through these stages.

One thing I noticed while reviewing the conversations is that agreeing to a next step and actually confirming that next step are two different things.

For example, a conversation might move towards arranging a meeting, but the details or the other person's understanding may not be completely clear.

That made me think beyond simply recording whether a call was successful or unsuccessful.

I wanted the product to preserve useful context so that the caller has something concrete to refer to after the conversation.

[Show the relevant implemented feature, if available.]

This is also why I kept the call history. Each call should remain a separate record, so the caller can review what happened previously.

## 3:25–4:20 — One important design decision

One decision I made was to focus on the structure of the conversation rather than trying to automate everything.

It's tempting to add a lot of AI features, but I don't think adding AI automatically makes a product useful.

For this problem, the more important question is whether the information helps the salesperson make a better decision.

For example, a useful assistant should distinguish between something the prospect explicitly agreed to do and something the caller merely suggested.

The same applies to unresolved questions. The software should show the actual evidence from the conversation rather than confidently inventing a problem.

This is the direction I want CallFlow to follow: give the caller useful context, but let the person make the final decision.

## 4:20–5:10 — How I built it

[Show the live application, then briefly show the repository or architecture.]

The frontend is built with Next.js and TypeScript. The backend uses FastAPI, and Supabase stores the application data.

The frontend communicates with the backend through API endpoints. The backend handles the application logic and connects to the database. Gemini is configured on the backend for the AI-related functionality.

I deployed the frontend on Vercel and the backend on Render.

[If time permits, briefly show the public GitHub repository and Render health endpoint.]

I also learned that getting an application to work locally is only one part of building it. Deployment introduces other problems, like environment variables, API communication, and making sure the frontend and backend work together.

I had to work through those issues as part of this project.

## 5:10–6:00 — What I learned and conclusion

This project is still a starting point, and there are things I would improve.

One important improvement would be better continuity between calls, so that before calling someone again, the salesperson can quickly review the previous conversation and any pending follow-up.

I'd also like to make follow-up reminders more useful and explore reliable transcription options where the calling setup supports them.

I haven't treated access to live phone-call audio as something that will automatically work on every device. That needs to be handled separately.

Overall, building CallFlow helped me think about how a relatively small interface can support an actual workflow, rather than just storing information.

Thank you for taking the time to review my work. I appreciate the opportunity, and I'm looking forward to your feedback.