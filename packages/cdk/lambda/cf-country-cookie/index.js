function handler(event) {
  var response = event.response;
  var request = event.request;
  var country = request.headers['cloudfront-viewer-country']
    ? request.headers['cloudfront-viewer-country'].value
    : '';

  if (country) {
    var cookieValue = 'cf_country=' + country + '; Path=/; Secure; SameSite=Lax; Max-Age=86400';
    if (!response.headers['set-cookie']) {
      response.headers['set-cookie'] = {};
    }
    // Use multiValue to avoid overwriting existing Set-Cookie headers
    if (!response.headers['set-cookie'].multiValue) {
      response.headers['set-cookie'].multiValue = [];
    }
    response.headers['set-cookie'].multiValue.push({ value: cookieValue });
  }

  return response;
}

// Export for testing (CloudFront Functions ignore module.exports)
if (typeof module !== 'undefined') {
  module.exports = { handler: handler };
}
