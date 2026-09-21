# API notes

The endpoint reference lives at https://api.weather.gov/openapi.json.

Points responses are cached for an hour; the forecast URL is derived from the
`properties.forecast` field of the points response.
