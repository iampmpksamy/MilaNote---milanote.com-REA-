package com.pmpksamy.noteboard;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ShareInPlugin.class);
        super.onCreate(savedInstanceState);
        ShareInPlugin.handle(getIntent(), getContentResolver());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        ShareInPlugin.handle(intent, getContentResolver());
    }
}
