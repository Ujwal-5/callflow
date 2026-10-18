import pytest
from starlette.testclient import TestClient
from backend.main import app
from backend.app.db import db


@pytest.fixture(autouse=True)
def force_sqlite():
    """Ensure tests run against local SQLite database."""
    original_force = getattr(db, "_force_sqlite", False)
    db._force_sqlite = True
    db.init_client()
    db.init_db()
    yield
    db._force_sqlite = original_force
    db.init_client()


def test_list_prospects_seeded():
    """Test that list_prospects returns all 100 seeded prospects."""
    client = TestClient(app)
    response = client.get("/prospects")
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 100

    # Verify a known prospect exists with its fields
    kalpana = next((p for p in data if p["company_name"] == "Kalpana Chem Supplies"), None)
    assert kalpana is not None
    assert kalpana["contact_name"] == "Dev Sharma (Director)"
    assert kalpana["phone_number"] == "+91 98450 12345"
    assert "Shared growth analysis report" in kalpana["context"]


def test_search_prospects():
    """Test filtering prospects via search query."""
    client = TestClient(app)
    response = client.get("/prospects?search=Kalpana")
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1
    assert any(p["company_name"] == "Kalpana Chem Supplies" for p in data)


def test_create_new_prospect_and_prevent_duplicate():
    """Test creating a new custom prospect and preventing duplicates."""
    client = TestClient(app)

    unique_company = "Apex Vanguard Robotics"

    # Clean up if existed
    conn = db.get_sqlite_conn()
    conn.execute("DELETE FROM prospects WHERE company_name = ?", (unique_company,))
    conn.commit()
    conn.close()

    # Create new prospect
    payload = {
        "company_name": unique_company,
        "contact_name": "Siddharth Verma (VP Engineering)",
        "phone_number": "+91 91234 56789",
        "context": "Interested in AI workflow automation",
    }
    response = client.post("/prospects", json=payload)
    assert response.status_code == 201
    created = response.json()
    assert created["company_name"] == unique_company
    assert created["contact_name"] == payload["contact_name"]
    assert created["is_custom"] is True

    # Check that it appears in list_prospects
    list_res = client.get("/prospects?search=Apex")
    assert list_res.status_code == 200
    assert any(p["company_name"] == unique_company for p in list_res.json())

    # Try duplicate creation (exact match)
    dup_res = client.post("/prospects", json=payload)
    assert dup_res.status_code == 409
    assert "already exists" in dup_res.json()["detail"]

    # Try duplicate creation (case insensitive & spaces)
    dup_res2 = client.post(
        "/prospects",
        json={
            "company_name": "  apex vanguard robotics  ",
            "contact_name": "Different Person",
        },
    )
    assert dup_res2.status_code == 409

    # Clean up
    conn = db.get_sqlite_conn()
    conn.execute("DELETE FROM prospects WHERE company_name = ?", (unique_company,))
    conn.commit()
    conn.close()


def test_start_call_workflow_with_selected_prospect():
    """Test that selecting a prospect and starting a call creates the call successfully."""
    client = TestClient(app)

    # 1. Fetch prospect
    p_res = client.get("/prospects?search=Kalpana")
    assert p_res.status_code == 200
    prospect = p_res.json()[0]

    # 2. Start Call with autofilled details
    call_payload = {
        "company_name": prospect["company_name"],
        "contact_name": prospect["contact_name"],
        "phone_number": prospect["phone_number"],
        "context": prospect["context"],
    }
    call_res = client.post("/calls", json=call_payload)
    assert call_res.status_code == 201
    call = call_res.json()
    assert call["company_name"] == "Kalpana Chem Supplies"
    assert call["contact_name"] == "Dev Sharma (Director)"
    assert call["status"] == "in_progress"
    assert call["current_stage"] == 1

    # 3. Advance stage & verify workflow is completely intact
    stage_update = {
        "selected_outcome": "Reached intended person",
        "notes": "Spoke to Dev Sharma",
    }
    stage_res = client.put(f"/calls/{call['id']}/stages/1", json=stage_update)
    assert stage_res.status_code == 200
    assert stage_res.json()["selected_outcome"] == "Reached intended person"
