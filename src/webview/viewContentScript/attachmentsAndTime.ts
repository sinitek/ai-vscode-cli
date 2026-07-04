// Attachment readers and datetime helper functions.
export const VIEW_CONTENT_SCRIPT_ATTACHMENTS_AND_TIME = `      function createMessageId() {
        return "web_" + Date.now() + "_" + Math.random().toString(16).slice(2);
      }

      function formatDateTime(timestamp) {
        const date = new Date(timestamp);
        const pad = (value) => String(value).padStart(2, "0");
        const year = date.getFullYear();
        const month = pad(date.getMonth() + 1);
        const day = pad(date.getDate());
        const hours = pad(date.getHours());
        const minutes = pad(date.getMinutes());
        const seconds = pad(date.getSeconds());
        return year + "-" + month + "-" + day + " " + hours + ":" + minutes + ":" + seconds;
      }

      function formatDateTimeWithMs(timestamp) {
        const date = new Date(timestamp);
        const pad = (value) => String(value).padStart(2, "0");
        const padMs = (value) => String(value).padStart(3, "0");
        const year = date.getFullYear();
        const month = pad(date.getMonth() + 1);
        const day = pad(date.getDate());
        const hours = pad(date.getHours());
        const minutes = pad(date.getMinutes());
        const seconds = pad(date.getSeconds());
        const ms = padMs(date.getMilliseconds());
        return year + "-" + month + "-" + day + " " + hours + ":" + minutes + ":" + seconds + "." + ms;
      }

`;
