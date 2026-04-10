---
name: Agency attorney data rules
description: Agency accounts always have a prosecutor; defense attorney may be blank and that's valid, not an error
type: project
---

For agency accounts, there will always be a prosecuting attorney on every case. A missing defense attorney is normal — it just means one hasn't been assigned yet. Blank defense attorney is valid data, not an enrichment failure.

**Why:** Agency users (prosecutors' offices) search by their own attorney name, which is always the prosecuting attorney. Defense counsel may not yet be appointed or assigned.

**How to apply:** Never treat missing defense attorney as an error or warning for agency accounts. The backfill logic in search.ts already correctly assigns searchResultAttorney as prosecutingAttorney for agency accounts and only backfills defenseAttorney from DB when available.
