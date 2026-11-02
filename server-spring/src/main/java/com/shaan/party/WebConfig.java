package com.shaan.party;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {
    // Web room lives under /app. The root path "/" stays reserved for the extension's WebSocket.
    @Override
    public void addViewControllers(ViewControllerRegistry registry) {
        registry.addRedirectViewController("/app", "/app/index.html").setKeepQueryParams(true);
        registry.addRedirectViewController("/app/", "/app/index.html").setKeepQueryParams(true);
    }
}
