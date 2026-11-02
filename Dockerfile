# Builds and runs the Shaan Party server (server-spring) in a container. Used by Render.
# ---- 1. build the jar ----
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /app
COPY server-spring/pom.xml .
RUN mvn -q -B dependency:go-offline
COPY server-spring/src ./src
RUN mvn -q -B -DskipTests package

# ---- 2. small runtime image ----
FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar
# Render's free instances have 512 MB of RAM, so keep Java small. Override JAVA_TOOL_OPTIONS in Render if you upgrade.
ENV JAVA_TOOL_OPTIONS="-Xmx256m -XX:MaxMetaspaceSize=96m -Xss512k -XX:+UseSerialGC -XX:TieredStopAtLevel=1"
# the server listens on $PORT (Render sets it; application.properties falls back to 8080)
EXPOSE 10000
ENTRYPOINT ["java", "-jar", "app.jar"]
