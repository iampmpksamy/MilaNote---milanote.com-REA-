package com.pmpksamy.noteboard;

import android.content.ContentResolver;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;

/**
 * Receives text, links and pictures shared to Noteboard from other apps (Android share sheet)
 * and hands them to the web app, which puts them in Unsorted. Pictures over 25 MB are skipped.
 */
@CapacitorPlugin(name = "NoteboardShareIn")
public class ShareInPlugin extends Plugin {
    private static final long MAX_BYTES = 25L * 1024 * 1024;
    private static JSObject pending;
    private static ShareInPlugin live;

    @Override
    public void load() {
        live = this;
    }

    /** Called by MainActivity for the intent that started the app and for later ones. */
    static void handle(Intent intent, ContentResolver resolver) {
        JSObject data = read(intent, resolver);
        if (data == null) return;
        if (live != null && live.hasListeners("shared")) live.notifyListeners("shared", data, true);
        else pending = data;
    }

    @PluginMethod
    public void takePending(PluginCall call) {
        JSObject p = pending;
        pending = null;
        call.resolve(p != null ? p : new JSObject());
    }

    private static JSObject read(Intent intent, ContentResolver resolver) {
        if (intent == null) return null;
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return null;
        JSObject out = new JSObject();
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        if (text != null) out.put("text", subject != null && !text.contains(subject) ? subject + "\n" + text : text);
        ArrayList<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) uris.add(u);
        } else {
            ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) uris.addAll(list);
        }
        JSArray files = new JSArray();
        int n = 0;
        for (Uri u : uris) {
            String type = resolver.getType(u);
            if (type == null || !type.startsWith("image/")) continue;
            try (InputStream in = resolver.openInputStream(u)) {
                if (in == null) continue;
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] chunk = new byte[64 * 1024];
                int r;
                long total = 0;
                while ((r = in.read(chunk)) > 0) {
                    total += r;
                    if (total > MAX_BYTES) break;
                    buf.write(chunk, 0, r);
                }
                if (total > MAX_BYTES) continue;
                JSObject f = new JSObject();
                f.put("name", "shared-" + (++n) + "." + type.substring(6).replaceAll("[^a-z0-9]", ""));
                f.put("type", type);
                f.put("data", Base64.encodeToString(buf.toByteArray(), Base64.NO_WRAP));
                files.put(f);
            } catch (Exception e) {
                // unreadable item: skip it
            }
        }
        if (files.length() > 0) out.put("files", files);
        return out.length() > 0 ? out : null;
    }
}
