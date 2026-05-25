## 2026-05-25

- Put a cap on message length
- Changed the passkey log-in flow, use your browser's autofill/dropdown instead.
- Fix the "use different email" loop on the login

## 2026-05-24

- You can disable the "thank you for checking in" emails now, handy if you check in often.
- Fix the checkin's location search drop-down from re-appearing

## 2026-05-23

- Fix wrong message when getting your location about it being required (it probably wasn't unless you're in a game)
- Android: the photo picker on the check-in form now offers the camera, so you can take a picture without leaving the page.

Thanks for the QA, Romain!

## 2026-05-22

- Added a beta banner across the top of every page that links here, and a public changelog with an embedded feedback form.
- Friendlier error messages when a check-in submit hits a network problem instead of just spinning.
- Photos are now shrunk on your device before upload, shown by a little spinner. When they're too large, you're also told.
- When captcha runs for anonymous users, hide it unless it fails.
- Photos start uploading in the background before you post so you're not hanging around for like 20 seconds waiting for them to go up.

## 2026-05-14 (more or less?)

- Fixed issues with Captcha lying
- Ease up the loaction verification so it _actually_ works in real scenarios, like, you know, a phone...

## Well...

Gonna be honest, I worked on this for like 4 weeks and didn't think that maybe it would be nice to track the progress. Anyway, at this stage, the app is somewhat useable but still a bit wonky. Those who went to the wedding will know what I mean ;)

But here we already have the full upload flow, map, emails, etc... The Game modes _somewhat_ work, but it still needs a bit of love.
