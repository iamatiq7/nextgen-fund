/**
 * NextGen Fund - member documents into Google Drive.
 *
 * Deploy this as a Web app (Execute as: me  |  Who has access: anyone) and paste the /exec URL
 * into assets/js/firebase-config.js as driveEndpoint. The site then posts each document here.
 *
 * For every upload it
 *   1. finds (or creates) a folder named after the member username
 *   2. names each file exactly: nid-front, nid-back, profile-picture, nominee-passport-photo
 *   3. replaces an older file of the same name, so a folder never collects duplicates
 *   4. answers with the folder id, the folder link and each file id/link
 *
 * The script runs as YOU (the fund owner), so a member never needs Drive access.
 */
var PARENT_FOLDER_ID = '';        // optional: a folder that keeps all member folders inside
var ROOT_NAME = 'NextGen Fund members';

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var username = String(body.username || body.folder || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) return json({ ok: false, error: 'bad-username' });
    var parent = PARENT_FOLDER_ID ? DriveApp.getFolderById(PARENT_FOLDER_ID) : rootFolder();
    var folder = findOrCreate(parent, username);
    var saved = [];
    (body.files || []).forEach(function (f) {
      var name = String(f.name || '').replace(/[^a-z0-9.-]/gi, '') || 'file';
      var mime = f.mime || 'image/jpeg';
      var blob = Utilities.newBlob(Utilities.base64Decode(f.base64), mime, name);
      var existing = folder.getFilesByName(name);
      while (existing.hasNext()) existing.next().setTrashed(true);
      var file = folder.createFile(blob);
      saved.push({ name: name, id: file.getId(), url: file.getUrl(), bytes: f.bytes || 0, mime: mime });
    });
    return json({ ok: true, folderId: folder.getId(), folderUrl: folder.getUrl(), username: username, files: saved });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}
function doGet() { return json({ ok: true, service: 'NextGen Fund drive upload', version: 1 }); }
function rootFolder() {
  var it = DriveApp.getFoldersByName(ROOT_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(ROOT_NAME);
}
function findOrCreate(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
