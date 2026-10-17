# CallFlow — AI-Powered Cold Call Assistant

> **Stay on track. Make every call count.**

CallFlow is an editorial-style, real-time web application built for B2B sales development representatives and account executives. It guides callers through a high-velocity 8-stage cold-call workflow with single-click outcome logging, prominent verbatim prospect note capture, early exit capability from any stage, structured call history search, and Google Gemini AI summarization.

---

## 1. Architecture Overview

CallFlow is architected with a decoupled frontend and backend:

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4. Designed with an editorial navy (`#070d1e`), slate-card, and vivid electric-blue (`#0062ff`) palette. Real-time active call state is kept in memory with debounced auto-save to backend and resilient local storage recovery across browser reloads.
- **Backend**: FastAPI (Python 3.13), Pydantic v2 validation models, Uvicorn ASGI server, structured logging, and automated test suite.
- **Persistence Layer**: Dual-mode storage architecture:
  - **Production**: Supabase (PostgreSQL) using the relational schema in `backend/sql/schema.sql` with UUID keys, unique constraints on `(call_id, stage_number)`, and performance indexing.
  - **Local Development / Offline Fallback**: Fully isolated SQLite database (`backend/callflow.db`) automatically activated when Supabase credentials are not configured, requiring zero external infrastructure to run locally.
- **LLM Synthesis**: Google Gen AI SDK (`google-genai` 2.31.0) using Gemini (`gemini-2.5-flash`) for structured JSON call summarization and next action extraction. The core calling workflow remains 100% operational even when the Gemini API is unconfigured or unreachable.

```
                      +-----------------------------+
                      |   Next.js 16 Web Client     |
                      |  - Active 8-Stage Call UI   |
                      |  - Historical Past Calls    |
                      +--------------+--------------+
                                     |
                             REST / JSON (CORS)
                                     |
                      +--------------v--------------+
                      |     FastAPI Backend         |
                      |  - /stages, /calls          |
                      |  - /calls/{id}/stages/{n}   |
                      |  - /calls/{id}/summary      |
                      +-------+--------------+------+
                              |              |
                +-------------+              +-------------+
                |                                          |
     +----------v----------+                    +----------v----------+
     | Persistence Adapter |                    |  Gemini AI Engine   |
     | - Supabase (Prod)   |                    |  (gemini-2.5-flash) |
     | - SQLite (Fallback) |                    |  - Structured Brief |
     +---------------------+                    +---------------------+
```

---

## 2. The Eight-Stage Cold-Call Workflow

| # | Stage Name | Stage Purpose | Common Prospect Situations | Mutual Exclusive Outcomes |
|---|---|---|---|---|
| **1** | **Opening** | Reach the right person and introduce yourself. | Switchboard screening, busy/driving/lunch, contact has left company. | Reached intended person, Assistant answered, Prospect unavailable, Wrong contact |
| **2** | **Purpose** | Explain why you called in 1-2 repeatable sentences. | Asks what company does, asks where number was found, identifies sales call. | Asked what we do, Asked about the number, Identified it as a sales call, Purpose understood |
| **3** | **Permission** | Establish whether prospect is willing to speak now. | Requests callback, agrees but remains quiet, speaks without agreeing. | Agreed to talk, Requested callback, Asked for a message, Did not agree to proceed |
| **4** | **Their business** | Understand company and work before pitching offering. | Describes work briefly, corrects assumption, asks about caller business first. | Explained their business, Corrected our assumption, Asked about our business, No useful information |
| **5** | **Their need, in their words** | Discover goals, struggles, and operational bottlenecks. | Mentions goal/problem, claims no need, asks what caller can offer. *(Prominent Verbatim Field)* | Identified a need, No current need, Asked what we can offer, Need unclear |
| **6** | **Objection** | Understand reason for hesitation/refusal before countering. | Has agency/internal team, refers to other decision-maker, asks for info in writing. | Existing provider, Wrong decision-maker, Requested written information, Other objection |
| **7** | **Next step** | Agree on one concrete next action with time, date, or channel. | WhatsApp/Email report, callback scheduled, meeting agreed. | Document requested, Callback scheduled, Meeting agreed, No next step |
| **8** | **Close** | Record outcome, next step, and prospect's words from stage 5. | Follow-up agreed, not interested, referred to another person. | Follow-up agreed, Not interested, Referred to another person, Call ended unexpectedly |

> **Key Rule**: The caller can end the call early at **any stage** (Stages 1 through 7) without penalty, reflecting real sales dynamics where >55% of cold calls exit before Stage 8.

---

## 3. Project Structure

```
callflow/
├── backend/
│   ├── app/
│   │   ├── config.py           # Pydantic Settings & environment variables
│   │   ├── db.py               # Supabase + SQLite database adapter
│   │   ├── llm.py              # Google Gen AI Gemini summary engine
│   │   ├── models.py           # Pydantic request/response schemas
│   │   ├── routes.py           # FastAPI router for all endpoints
│   │   └── stages_data.py      # Eight cold-call stages definition & options
│   ├── cold-call-transcripts-100/ # 100 real cold-call transcripts dataset
│   ├── sql/
│   │   └── schema.sql          # PostgreSQL / Supabase relational schema
│   ├── tests/
│   │   └── test_api.py         # Automated test suite (unittest / TestClient)
│   ├── .env.example            # Backend env documentation
│   ├── main.py                 # FastAPI application entrypoint & CORS
│   └── requirements.txt        # Pinned Python dependencies
├── docs/
│   └── transcript-findings.md  # Rigorous auditable analysis of 100 transcripts
├── frontend/
│   ├── public/                 # Static assets
│   ├── src/
│   │   ├── app/
│   │   │   ├── globals.css     # Tailwind v4 styles & theme variables
│   │   │   ├── layout.tsx      # Root HTML layout & fonts
│   │   │   └── page.tsx        # Main application controller
│   │   ├── components/
│   │   │   ├── CallDetailModal.tsx   # Past call inspection & AI summary
│   │   │   ├── CurrentStagePanel.tsx # Active stage guide & controls
│   │   │   ├── EndCallModal.tsx      # Early exit & completion modal
│   │   │   ├── Header.tsx            # App bar, live call indicator & nav
│   │   │   ├── OutcomeButtons.tsx    # 4 mutually exclusive stage outcomes
│   │   │   ├── PastCallsList.tsx     # Historical calls table with filters
│   │   │   ├── ProspectNotesField.tsx# Verbatim exact-words text area
│   │   │   ├── StageProgress.tsx     # 8-stage stepper indicator
│   │   │   └── StartCallPanel.tsx    # Prospect setup form
│   │   ├── lib/
│   │   │   └── api.ts          # Strongly typed client for FastAPI
│   │   └── types/
│   │       └── index.ts        # TypeScript data interfaces
│   ├── .env.example            # Frontend env documentation
│   ├── next.config.ts          # Next.js configuration
│   ├── package.json            # Node dependencies
│   └── tsconfig.json           # TypeScript configuration
├── render.yaml                 # Infrastructure-as-code for Render deployment
└── README.md                   # Project documentation
```

---

## 4. Local Setup & Quickstart

### Prerequisites
- Node.js 18+ (tested on Node v22)
- Python 3.10+ (tested on Python 3.13)
- npm or pnpm

### 1. Backend Setup

```bash
cd backend

# Create virtual environment if not already present
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure environment variables
cp .env.example .env
# Edit .env with your optional GEMINI_API_KEY or SUPABASE credentials

# Run database tests
python -m unittest tests/test_api.py -v

# Start FastAPI backend server on port 8000
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

The backend starts at `http://127.0.0.1:8000`. Test health:
```bash
curl http://127.0.0.1:8000/health
```

### 2. Frontend Setup

In a new terminal window:

```bash
cd frontend

# Install dependencies (if needed)
npm install

# Copy example environment
cp .env.example .env.local

# Run production build or development server
npm run dev
# or
npm run build && npm run start
```

Open `http://localhost:3000` in your web browser.

---

## 5. Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `8000` | Port for the uvicorn HTTP server |
| `FRONTEND_ORIGIN` | No | `http://localhost:3000,http://127.0.0.1:3000` | Comma-separated allowed origins for CORS |
| `GEMINI_API_KEY` | No | `""` | Google Gemini API key (server-side only, never shared with client) |
| `SUPABASE_URL` | No | `""` | Supabase project URL (if omitted, SQLite is used) |
| `SUPABASE_SERVICE_ROLE_KEY` | No | `""` | Supabase service role secret key |
| `DATABASE_URL` | No | `""` | Optional direct PostgreSQL connection string |

### Frontend (`frontend/.env.local`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | No | `http://localhost:8000` | Public backend endpoint URL |

---

## 6. Database Schema Setup

### Supabase / PostgreSQL (Production)
Run the script located at `backend/sql/schema.sql` directly inside the Supabase SQL Editor:

```sql
-- Creates calls and call_stage_results tables
-- Enforces UNIQUE(call_id, stage_number)
-- Sets up indexes for fast history search and RLS policies
```

### SQLite Fallback (Local Development)
When `SUPABASE_URL` is omitted, CallFlow automatically creates and initializes `backend/callflow.db` with identical schemas and constraints upon startup. Zero configuration required.

---

## 7. API Reference

### Health & Stages
- `GET /health`: Service status, active database mode (`supabase` or `sqlite_fallback`), and Gemini configuration status.
- `GET /stages`: Returns all 8 cold-call stage specifications, purpose, common responses, and outcome buttons.

### Calls
- `POST /calls`: Create a new call session.
  - Body: `{"company_name": "Acme Inc", "contact_name": "Jane", "phone_number": "+1...", "context": "Inbound"}`
- `GET /calls`: List saved calls. Supports query parameters `?search=...`, `?outcome=...`, `?stage=...`, `?status=...`.
- `GET /calls/{call_id}`: Retrieve a call record with all captured stage results.
- `PUT /calls/{call_id}/stages/{stage_number}`: Upsert stage outcome, verbatim words, and notes. Validates stage 1-8.
- `POST /calls/{call_id}/advance?stage_number={n}`: Advance active call stage.
- `POST /calls/{call_id}/close`: Conclude call and record final outcome, next action, follow-up timing, and channel.
- `POST /calls/{call_id}/summary`: Generate AI call summary and suggested next steps using Google Gemini.

---

## 8. Transcript Analysis Findings

The workspace contains 100 cold-call transcripts (`T001.txt` to `T100.txt`). An auditable analysis was performed using Python and documented in `docs/transcript-findings.md`.

Key Findings:
1. **Median call duration is 93.5 seconds** (mean: 135.6s), proving callers need rapid, single-click outcome logging rather than lengthy manual input.
2. **13% of legacy calls had no outcome logged at all** (`not_logged`), and 0% captured verbatim quotes.
3. **Over 55% of cold calls terminate early** (18% at Stage 1, 10% at Stage 2-3, 17% at Stage 6).
4. Verbatim prospect words (e.g. `T012`: chemical manufacturing job-work margin constraints) held vital product intelligence that legacy categorical tags obliterated.

---

## 9. Deployment Instructions

### Backend on Render
1. Push this repository to GitHub.
2. In Render, select **New > Web Service** and connect the repository (or use the included `render.yaml` blueprint).
3. Configuration:
   - **Runtime**: Python 3
   - **Build Command**: `pip install -r backend/requirements.txt`
   - **Start Command**: `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
   - **Health Check Path**: `/health`
4. Set Environment Variables:
   - `GEMINI_API_KEY`: Your Google Gen AI key.
   - `SUPABASE_URL`: Your Supabase URL.
   - `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase key.
   - `FRONTEND_ORIGIN`: Your deployed Vercel frontend URL.

### Frontend on Vercel
1. In Vercel, click **Add New Project** and select the repository.
2. Set **Root Directory** to `frontend`.
3. Set Environment Variable:
   - `NEXT_PUBLIC_API_BASE_URL`: `https://your-render-service.onrender.com`
4. Deploy.

### Production URLs
- **Frontend (Vercel)**: `https://callflow-app.vercel.app`
- **Backend (Render)**: `https://callflow-api.onrender.com`

---

## 10. Automated Tests

Run the backend test suite:
```bash
./backend/.venv/bin/python -m unittest backend/tests/test_api.py -v
```

All 10 tests verify:
- Service health check
- Exact 8-stage sequence and metadata
- Call session creation and validation
- Upserting stage results without duplicating records
- Preservation of verbatim Stage 5 quotes
- Early call termination from any stage
- Full call conclusion with follow-up timing
- Call history search and filtering
- Boundary validation (rejecting invalid stages 0 and 9)
- Graceful Gemini summary fallback when unconfigured
