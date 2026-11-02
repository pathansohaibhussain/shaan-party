# Shaan Party server (Spring Boot)
Requires Java 17+ and Maven.

    mvn spring-boot:run              # ws://localhost:8080
    mvn clean package && java -jar target/party-server-1.0.0.jar
    PORT=9000 java -jar target/party-server-1.0.0.jar

Extension popup server URL: ws://localhost:8080  (or wss://your-host once deployed behind HTTPS)
