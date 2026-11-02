package com.shaan.party;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {
    private final PartyHandler handler;

    public WebSocketConfig(PartyHandler handler) {
        this.handler = handler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        // "*" is needed because the browser sends a chrome-extension:// origin
        registry.addHandler(handler, "/", "/ws").setAllowedOrigins("*");
    }

    @Bean
    public ServletServerContainerFactoryBean containerFactory() {
        ServletServerContainerFactoryBean c = new ServletServerContainerFactoryBean();
        c.setMaxTextMessageBufferSize(64 * 1024);
        c.setMaxSessionIdleTimeout(120_000L);
        return c;
    }
}
