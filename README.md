# Scrapyard Scavengers: turn and HP tracker

The frontend (`index.html`, `style.css`, `app.js`) is static, so it can live on GitHub Pages. The backend (`backend/app.py`) is a small Python Flask server that keeps the rooms, turn order and HP. GitHub Pages can't run Python, so the backend has to be hosted somewhere else.

## Run it on your computer

```bash
cd backend
pip install -r requirements.txt
python app.py
```

Then open `index.html` in a browser. `app.js` already points to `http://localhost:5000`. This only works on the same computer. A phone can't reach your computer's `localhost`.

**Testing with more than one player on one device:** each browser remembers who you are, so two normal tabs count as the same player. Use one normal tab and one private (incognito) tab, or two different browsers.

## Put it online

1. **Deploy the backend.** Any host that runs Python works (Render, Railway, PythonAnywhere). On Render, create a Web Service from your repo, set the root directory to `backend`, the build command to `pip install -r requirements.txt`, and the start command to `gunicorn app:app`.
2. **Point the frontend at it.** In `app.js`, change the `API` line to your backend URL (no trailing slash, and it must start with `https://`).
3. **Publish the frontend.** Push `index.html`, `style.css` and `app.js` to a GitHub repo, then turn on Settings > Pages and choose the branch.
4. **Optional:** on the backend host, set `ALLOWED_ORIGIN` to `https://YOUR-USERNAME.github.io` so only your page can call it.

## Testing on a phone only

1. Do the steps above first, so both the page and the server are online.
2. Open your GitHub Pages link on the phone. The first load can take up to a minute if the free server was asleep.
3. Create a room in a normal browser tab.
4. Open the same link in a private tab, join with the room code and a different username.
5. Switch between the two tabs to play both sides.

If the page loads but says it can't reach the game server, school Wi-Fi may be blocking the backend site. Try mobile data to check.

## Notes

- Rooms are kept in the server's memory, so a restart clears them. Rooms older than 12 hours are cleaned up automatically.
- Free hosts put the server to sleep when it's idle, so the first request after a while can be slow.
- Run a single worker. With `gunicorn`, don't add `--workers`, because each worker would keep its own set of rooms.
