# Rhythms of Life Postman Load Testing

This directory contains a Postman collection and environment for semi-automated load and performance testing of the Rhythms of Life Django portal.

## Files

- `rhythms_of_life_load_testing.postman_collection.json`
- `rhythms_of_life_local.postman_environment.json`

## Start the Django server

If you run the project through Docker, start the application containers first from the project root:

```powershell
cd C:\work\RhymesOfLife
docker compose up -d
```

The default environment in the Postman files assumes the app is reachable at:

```text
http://127.0.0.1:8000
```

## Import into Postman

1. Open Postman.
2. Import `rhythms_of_life_load_testing.postman_collection.json`.
3. Import `rhythms_of_life_local.postman_environment.json`.
4. Select the `Rhythms of Life Local` environment.

## Configure variables

Set these variables before running the collection:

- `base_url`
- `login_identity`
- `password`
- `doctor_login_identity`
- `doctor_password`
- `staff_login_identity`
- `staff_password`

The collection automatically captures:

- `csrf_token`
- `sessionid`

The environment also includes placeholders for:

- `created_exam_id`
- `created_post_id`
- `created_help_request_id`

These IDs are not automatically populated because the current create routes do not return object IDs in their responses.

## Test account requirements

Use realistic non-production test accounts only.

### Regular user

The regular user should be:

- able to log in successfully;
- fully onboarded;
- verified enough to avoid onboarding redirects;
- allowed to access `/profile/`, `/my-health/`, `/my-documents/`, `/my-wellness/`, `/ma/`, `/notifications/`, and `/help/request/`.

### Doctor account

The doctor account should be able to open:

- `/patients/`
- `/access/requests/`

This usually means a staff, external doctor, or permission-enabled medical user depending on your local database setup.

### Staff account

The staff account should be able to open:

- `/staff/help-requests/`
- `/staff/notify/`

This usually means `is_staff=True` or the matching Django permissions:

- `base.view_help_requests`
- `base.send_notifications`

## Authentication and CSRF

The collection uses Django session authentication.

Flow:

1. `GET Login Page` loads the real `/login/` route and captures `csrftoken`.
2. `POST Login ...` sends credentials and stores `sessionid`.
3. Collection-level pre-request logic adds:
   - `X-CSRFToken`
   - `Cookie: csrftoken=...; sessionid=...`

If your local Postman instance does not keep cookies as expected:

1. Run `GET Login Page`.
2. Confirm that `csrf_token` is populated in the environment.
3. Run the matching `POST Login ...` request once manually.
4. Confirm that `sessionid` is populated.
5. Then run the target folder in Collection Runner.

## Included routes

### Public

- `GET /`
- `GET /login/`

### Regular user

- `POST /login/`
- `GET /profile/`
- `GET /my-health/`
- `GET /my-documents/`
- `POST /my-documents/`
- `GET /my-wellness/`
- `GET /my-health/medications/`
- `GET /ma/`
- `POST /posts/create/`
- `GET /articles/`
- `GET /notifications/`
- `GET /help/request/`
- `POST /help/request/`
- `POST /logout/`

### Doctor

- `POST /login/`
- `GET /patients/`
- `GET /access/requests/`
- `POST /logout/`

### Staff

- `POST /login/`
- `GET /staff/help-requests/`
- `GET /staff/notify/`
- `POST /logout/`

## Skipped or adjusted cases

- File upload performance was not included because Postman file paths are machine-specific and not portable in a shared collection.
- The medical exam create flow uses the real `/my-documents/` POST route with `external_url` instead of uploading a local file.
- Article listing uses the real `/articles/` Wagtail route. It requires a configured and published blog index page in the database.
- The requested generic “medical exams list” route was mapped to `/my-documents/`, because this project stores and renders exams there.
- No request was added for “create help request ID capture” or “create post ID capture” because the current views do not return those IDs.

## Run the load test

Use Collection Runner and execute folders separately by role.

### Recommended iterations

- GET page folders: `50`
- POST create operations: `20`

### Suggested run order

1. Run `Public Pages`
2. Run `Regular User Flow`
3. Run `Doctor Flow`
4. Run `Staff Flow`

If one account covers multiple roles in your local setup, you can reuse it by adjusting the environment variables.

## What to screenshot for the report

Take screenshots of:

- the Collection Runner summary;
- total requests;
- successful requests count;
- failed requests count;
- average response time;
- maximum response time;
- per-request timing table for the main routes.

## How to fill the report table

For each tested route or folder, record:

- route or scenario name;
- number of iterations;
- average response time;
- maximum response time;
- successful requests;
- errors or failed requests.

If you need a compact report format, use one row per route group:

- Public pages
- Authentication
- Health pages
- Feed and posts
- Articles
- Help requests
- Doctor pages
- Staff pages
