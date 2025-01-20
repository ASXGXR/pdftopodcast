document.addEventListener("DOMContentLoaded", function () {
  fetch("footer/footer.html")
    .then((response) => {
      if (!response.ok) {
        throw new Error("Failed to load footer.html");
      }
      return response.text();
    })
    .then((footerHtml) => {
      document.body.insertAdjacentHTML("beforeend", footerHtml);
    })
    .catch((error) => {
      console.error("Error loading footer:", error);
    });
});