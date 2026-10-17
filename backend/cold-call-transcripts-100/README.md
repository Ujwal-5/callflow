# 100 cold-call transcripts

One hundred calls made by a Hyderabad company that sells growth analysis and growth work to Indian businesses. The callers are reaching owners, directors and senior managers they have never spoken to, or spoke to once before. Most calls last under two minutes. Some run to ten.

Every company and every person in these files is fictional. The calls are rewritten from real ones: the structure of each call, who spoke when, what was asked and what was answered, and how it ended are kept. Names, numbers, addresses and anything that could point to a real company or person are changed or removed. The caller's company is called Meridian Growth Partners throughout; it does not exist.

## Files

- `transcripts/T001.txt` to `T100.txt`: one call per file.
- `index.csv` and `index.json`: one row per call with the header fields below and the turn count.

## Format of one file

```
# T046
duration_seconds: 162
outcome: not_logged
prospect_role: Director
company_kind: mid-size private company
company: Kalyx Enterprises (fictional)
caller: Arjun, Meridian Growth Partners (fictional)

CALLER: Hello.
PROSPECT: Hello.
...
```

- `CALLER` is the person from Meridian. `PROSPECT` is the person called. `RECEPTION` appears on a few calls that went through a switchboard.
- `outcome` is what the caller logged in their system after the call. It is their word, and it does not always match what you read in the call. That is part of the data.
- `company_kind` is one of: listed Indian company, India arm of a multinational, mid-size private company, mid-size private manufacturer, large private company, startup, small private company, public sector utility, not known.

## Outcome words

| outcome | meaning as the callers used it |
|---|---|
| agreed_to_receive_report | the prospect agreed to receive a document, on WhatsApp or email |
| next_step_agreed | a meeting, a call at a set time, or a report plus a follow-up call was agreed |
| interested | the prospect said they were interested, without a fixed next step |
| follow_up | the caller is to call again |
| call_again | the number is to be called again, often because of language or line quality |
| not_interested | the prospect declined |
| do_not_call | the prospect asked not to be called, or the caller judged it so |
| wrong_person | the person reached was not the person listed, or not the right person |
| moved_company | the person no longer works at the listed company |
| not_logged | the caller logged nothing for this call |

## Languages

Most calls are in English. Several switch into Hindi or Hinglish. Two are partly in Marathi. One is in Hindi written in Devanagari. One prospect asks for Kannada. This is what the calls were like.

## Things to know before you rely on them

- The transcription that produced the originals swaps the CALLER and PROSPECT labels in places. Most of those were corrected in the rewrite; some may remain. Read a few lines either side before you trust a label.
- Lines that break off mid-sentence are breaks in the original call: the line dropped, or someone spoke over someone.
- Where a prospect gave a phone number or an email address, the file says so in brackets instead of giving one.
- The durations are the recording lengths in seconds. The text of a short call can be longer than the text of a longer one, because of silences.

## Use

These files are provided for one purpose: to read how real cold calls go, stage by stage, and to build and test a tool on them. Nothing in them is to be published, and no attempt is to be made to identify the companies or people the originals came from.
