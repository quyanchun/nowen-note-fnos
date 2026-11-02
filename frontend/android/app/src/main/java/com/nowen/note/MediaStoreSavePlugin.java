package com.nowen.note;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;

/**
 * Android export bridge:
 * - MediaStore gallery writes (Android 10+ scoped storage, no broad permission)
 * - ACTION_CREATE_DOCUMENT for user-selected Files locations
 * - FileProvider-backed native share sheet
 * - opening the concrete content:// result after export
 */
@CapacitorPlugin(name = "MediaStoreSave")
public class MediaStoreSavePlugin extends Plugin {

    private static byte[] decodeRequiredBase64(PluginCall call) {
        String base64Data = call.getString("base64Data");
        if (base64Data == null || base64Data.isEmpty()) {
            throw new IllegalArgumentException("base64Data is required");
        }
        return Base64.decode(base64Data, Base64.DEFAULT);
    }

    private static String safeFileName(String raw, String fallback) {
        String value = raw == null || raw.trim().isEmpty() ? fallback : raw.trim();
        value = value.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1F]", "_");
        return value.length() > 180 ? value.substring(0, 180) : value;
    }

    private String resolveDisplayName(Uri uri, String fallback) {
        if (uri == null) return fallback;
        try (Cursor cursor = getContext().getContentResolver().query(
                uri,
                new String[] { MediaStore.MediaColumns.DISPLAY_NAME },
                null,
                null,
                null
        )) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME);
                if (index >= 0) {
                    String value = cursor.getString(index);
                    if (value != null && !value.isEmpty()) return value;
                }
            }
        } catch (Exception ignored) {
            // URI itself remains a valid fallback.
        }
        return fallback;
    }

    @PluginMethod
    public void saveImage(PluginCall call) {
        String fileName = safeFileName(call.getString("fileName"), "image.png");
        String mimeType = call.getString("mimeType", "image/png");
        String relativePath = call.getString(
                "relativePath",
                Environment.DIRECTORY_PICTURES + "/Nowen Note"
        );
        Uri uri = null;

        try {
            byte[] data = decodeRequiredBase64(call);
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
            values.put(MediaStore.Images.Media.MIME_TYPE, mimeType);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.put(MediaStore.Images.Media.RELATIVE_PATH, relativePath);
                values.put(MediaStore.Images.Media.IS_PENDING, 1);
            }

            uri = getContext().getContentResolver().insert(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    values
            );
            if (uri == null) throw new IOException("Failed to create MediaStore entry");

            try (OutputStream stream = getContext().getContentResolver().openOutputStream(uri)) {
                if (stream == null) throw new IOException("Failed to open MediaStore output stream");
                stream.write(data);
                stream.flush();
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.clear();
                values.put(MediaStore.Images.Media.IS_PENDING, 0);
                getContext().getContentResolver().update(uri, values, null, null);
            }

            JSObject result = new JSObject();
            result.put("success", true);
            result.put("uri", uri.toString());
            result.put("displayPath", relativePath + "/" + fileName);
            call.resolve(result);
        } catch (Exception error) {
            if (uri != null) {
                try { getContext().getContentResolver().delete(uri, null, null); } catch (Exception ignored) {}
            }
            call.reject("Failed to save image: " + error.getMessage(), error);
        }
    }

    @PluginMethod
    public void saveFile(PluginCall call) {
        try {
            // Validate data before opening the system picker; the original value remains on PluginCall
            // and is decoded again in saveFileResult after the user chooses a destination.
            decodeRequiredBase64(call);
            String fileName = safeFileName(call.getString("fileName"), "nowen-note-export.bin");
            String mimeType = call.getString("mimeType", "application/octet-stream");

            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(mimeType);
            intent.putExtra(Intent.EXTRA_TITLE, fileName);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            startActivityForResult(call, intent, "saveFileResult");
        } catch (Exception error) {
            call.reject("Unable to open system file picker: " + error.getMessage(), error);
        }
    }

    @ActivityCallback
    private void saveFileResult(PluginCall call, ActivityResult activityResult) {
        if (call == null) return;
        Intent dataIntent = activityResult.getData();
        if (activityResult.getResultCode() != Activity.RESULT_OK || dataIntent == null || dataIntent.getData() == null) {
            JSObject canceled = new JSObject();
            canceled.put("success", false);
            canceled.put("canceled", true);
            canceled.put("uri", "");
            call.resolve(canceled);
            return;
        }

        Uri uri = dataIntent.getData();
        String fileName = safeFileName(call.getString("fileName"), "nowen-note-export.bin");
        try {
            byte[] bytes = decodeRequiredBase64(call);
            try (OutputStream stream = getContext().getContentResolver().openOutputStream(uri, "w")) {
                if (stream == null) throw new IOException("Unable to open selected document");
                stream.write(bytes);
                stream.flush();
            }

            try {
                int flags = dataIntent.getFlags() & (
                        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                );
                getContext().getContentResolver().takePersistableUriPermission(uri, flags);
            } catch (Exception ignored) {
                // Some document providers do not offer persistable grants; the write already succeeded.
            }

            JSObject result = new JSObject();
            result.put("success", true);
            result.put("canceled", false);
            result.put("uri", uri.toString());
            result.put("displayPath", resolveDisplayName(uri, fileName));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Failed to write selected file: " + error.getMessage(), error);
        }
    }

    @PluginMethod
    public void shareFiles(PluginCall call) {
        JSArray input = call.getArray("files");
        if (input == null || input.length() == 0) {
            call.reject("files is required");
            return;
        }

        try {
            File shareDir = new File(getContext().getCacheDir(), "note-image-exports");
            if (!shareDir.exists() && !shareDir.mkdirs()) {
                throw new IOException("Unable to create share cache directory");
            }

            File[] oldFiles = shareDir.listFiles();
            if (oldFiles != null) {
                long cutoff = System.currentTimeMillis() - 24L * 60L * 60L * 1000L;
                for (File old : oldFiles) {
                    if (old.isFile() && old.lastModified() < cutoff) {
                        try { old.delete(); } catch (Exception ignored) {}
                    }
                }
            }

            ArrayList<Uri> uris = new ArrayList<>();
            String commonMime = null;
            for (int index = 0; index < input.length(); index++) {
                JSONObject item = input.getJSONObject(index);
                String encoded = item.optString("base64Data", "");
                if (encoded.isEmpty()) throw new IllegalArgumentException("files[" + index + "].base64Data is required");
                String fileName = safeFileName(item.optString("fileName", "export-" + index + ".bin"), "export-" + index + ".bin");
                String mimeType = item.optString("mimeType", "application/octet-stream");
                if (commonMime == null) commonMime = mimeType;
                else if (!commonMime.equals(mimeType)) commonMime = "*/*";

                File target = new File(shareDir, System.currentTimeMillis() + "-" + index + "-" + fileName);
                try (FileOutputStream stream = new FileOutputStream(target)) {
                    stream.write(Base64.decode(encoded, Base64.DEFAULT));
                    stream.flush();
                }
                Uri uri = FileProvider.getUriForFile(
                        getContext(),
                        getContext().getPackageName() + ".fileprovider",
                        target
                );
                uris.add(uri);
            }

            Intent shareIntent;
            if (uris.size() == 1) {
                shareIntent = new Intent(Intent.ACTION_SEND);
                shareIntent.putExtra(Intent.EXTRA_STREAM, uris.get(0));
            } else {
                shareIntent = new Intent(Intent.ACTION_SEND_MULTIPLE);
                shareIntent.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
            }
            shareIntent.setType(commonMime == null ? "*/*" : commonMime);
            shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            ClipData clipData = new ClipData(
                    "Nowen Note export",
                    new String[] { commonMime == null ? "*/*" : commonMime },
                    new ClipData.Item(uris.get(0))
            );
            for (int index = 1; index < uris.size(); index++) {
                clipData.addItem(new ClipData.Item(uris.get(index)));
            }
            shareIntent.setClipData(clipData);

            String title = call.getString("title", "分享 Nowen Note 导出");
            getActivity().startActivity(Intent.createChooser(shareIntent, title));

            JSObject result = new JSObject();
            result.put("success", true);
            result.put("count", uris.size());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Failed to share exported files: " + error.getMessage(), error);
        }
    }

    @PluginMethod
    public void openUri(PluginCall call) {
        String rawUri = call.getString("uri");
        String mimeType = call.getString("mimeType", "*/*");
        if (rawUri == null || rawUri.isEmpty()) {
            call.reject("uri is required");
            return;
        }

        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(Uri.parse(rawUri), mimeType);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to open exported file: " + error.getMessage(), error);
        }
    }
}
