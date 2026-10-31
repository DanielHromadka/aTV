# Verification required by the user

For changes affecting aTV media discovery, navigation to media, source integrations, or playback, verify the complete user flow in the running browser through actual playback. A passing build, unit tests, a search result, or an opened player alone is not sufficient.

Verify that playback time advances, media is ready, no media error is reported, and audio is not muted when sound is expected. Exercise the affected source/path, and report the tested title and provider. If a live source or peers prevent verification, state the concrete blocker and do not claim playback passed. Respect applicable content and authorization limits.
